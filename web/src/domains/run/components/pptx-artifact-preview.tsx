import * as React from "react";

import { Button } from "@/shared/ui/button";

interface ZipEntry {
  compressedSize: number;
  compressionMethod: number;
  dataOffset: number;
}

interface SlideFrame {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface PptxTextBox {
  color: string | null;
  fill: string | null;
  fontSize: number | null;
  frame: SlideFrame;
  id: string;
  text: string;
}

interface PptxImage {
  frame: SlideFrame;
  id: string;
  url: string;
}

interface PptxSlide {
  background: string;
  id: string;
  images: PptxImage[];
  textBoxes: PptxTextBox[];
  title: string;
}

interface PptxDeck {
  height: number;
  slides: PptxSlide[];
  width: number;
}

const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const RELATIONSHIP_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - 66_000);

  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32(view, offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("PPTX zip directory를 찾지 못했습니다.");
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const DecompressionStreamCtor = (
    globalThis as typeof globalThis & {
      DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).DecompressionStream;

  if (!DecompressionStreamCtor) {
    throw new Error("이 브라우저는 PPTX 압축 해제를 지원하지 않습니다.");
  }

  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(
    new DecompressionStreamCtor("deflate-raw")
  );

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
}

class ZipArchive {
  private constructor(
    private readonly bytes: Uint8Array,
    private readonly entries: Map<string, ZipEntry>
  ) {}

  static from(buffer: ArrayBuffer): ZipArchive {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const decoder = new TextDecoder("utf-8");
    const entries = new Map<string, ZipEntry>();
    const eocdOffset = findEndOfCentralDirectory(view);
    const entryCount = readUint16(view, eocdOffset + 10);
    let offset = readUint32(view, eocdOffset + 16);

    for (let index = 0; index < entryCount; index += 1) {
      if (readUint32(view, offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
        throw new Error("PPTX zip directory가 손상되었습니다.");
      }

      const compressionMethod = readUint16(view, offset + 10);
      const compressedSize = readUint32(view, offset + 20);
      const fileNameLength = readUint16(view, offset + 28);
      const extraLength = readUint16(view, offset + 30);
      const commentLength = readUint16(view, offset + 32);
      const localHeaderOffset = readUint32(view, offset + 42);
      const nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
      const name = decoder.decode(nameBytes);

      if (readUint32(view, localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
        throw new Error(`PPTX zip entry가 손상되었습니다: ${name}`);
      }

      const localNameLength = readUint16(view, localHeaderOffset + 26);
      const localExtraLength = readUint16(view, localHeaderOffset + 28);
      entries.set(name, {
        compressedSize,
        compressionMethod,
        dataOffset: localHeaderOffset + 30 + localNameLength + localExtraLength,
      });

      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return new ZipArchive(bytes, entries);
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  async readBytes(name: string): Promise<Uint8Array> {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`PPTX 내부 파일을 찾지 못했습니다: ${name}`);
    }

    const compressed = this.bytes.subarray(
      entry.dataOffset,
      entry.dataOffset + entry.compressedSize
    );

    if (entry.compressionMethod === 0) {
      return compressed;
    }

    if (entry.compressionMethod === 8) {
      return inflateRaw(compressed);
    }

    throw new Error(`지원하지 않는 PPTX 압축 방식입니다: ${entry.compressionMethod}`);
  }

  async readText(name: string): Promise<string> {
    return new TextDecoder("utf-8").decode(await this.readBytes(name));
  }
}

function parseXml(xml: string, source: string): XMLDocument {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];

  if (parserError) {
    throw new Error(`PPTX XML 파싱 실패: ${source}`);
  }

  return doc;
}

function descendants(element: Element | Document, localName: string): Element[] {
  return Array.from(element.getElementsByTagName("*")).filter(
    (entry) => entry.localName === localName
  );
}

function firstDescendant(
  element: Element | Document | null | undefined,
  localName: string
): Element | null {
  if (!element) {
    return null;
  }

  return descendants(element, localName)[0] ?? null;
}

function directChild(element: Element | null | undefined, localName: string): Element | null {
  if (!element) {
    return null;
  }

  return Array.from(element.children).find((entry) => entry.localName === localName) ?? null;
}

function parseInteger(value: string | null): number | null {
  if (!value || !/^-?\d+$/.test(value)) {
    return null;
  }

  return Number(value);
}

function parseColor(value: string | null): string | null {
  if (!value || !/^[0-9a-fA-F]{6}$/.test(value)) {
    return null;
  }

  return `#${value}`;
}

function solidFillColor(element: Element | null | undefined): string | null {
  const solidFill = firstDescendant(element, "solidFill");
  const srgbColor = firstDescendant(solidFill, "srgbClr");

  return parseColor(srgbColor?.getAttribute("val") ?? null);
}

function parseSlideSize(presentationXml: XMLDocument): { height: number; width: number } {
  const slideSize = firstDescendant(presentationXml, "sldSz");
  const width = parseInteger(slideSize?.getAttribute("cx") ?? null);
  const height = parseInteger(slideSize?.getAttribute("cy") ?? null);

  return {
    height: height && height > 0 ? height : 5_143_500,
    width: width && width > 0 ? width : 9_144_000,
  };
}

function parseFrame(
  element: Element,
  deckSize: { height: number; width: number },
  fallbackIndex: number
): SlideFrame {
  const transform = firstDescendant(element, "xfrm");
  const off = firstDescendant(transform, "off");
  const ext = firstDescendant(transform, "ext");
  const x = parseInteger(off?.getAttribute("x") ?? null);
  const y = parseInteger(off?.getAttribute("y") ?? null);
  const width = parseInteger(ext?.getAttribute("cx") ?? null);
  const height = parseInteger(ext?.getAttribute("cy") ?? null);

  if (x !== null && y !== null && width !== null && height !== null) {
    return {
      height: (height / deckSize.height) * 100,
      width: (width / deckSize.width) * 100,
      x: (x / deckSize.width) * 100,
      y: (y / deckSize.height) * 100,
    };
  }

  return {
    height: fallbackIndex === 0 ? 14 : 12,
    width: 82,
    x: 9,
    y: 9 + fallbackIndex * 13,
  };
}

function parseRelationships(xml: string): Map<string, string> {
  const doc = parseXml(xml, "relationships");
  const relationshipById = new Map<string, string>();

  for (const relationship of descendants(doc, "Relationship")) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");

    if (id && target) {
      relationshipById.set(id, target);
    }
  }

  return relationshipById;
}

function normalizeZipPath(baseFile: string, target: string): string {
  if (target.startsWith("/")) {
    return target.slice(1);
  }

  const baseParts = baseFile.split("/").slice(0, -1);
  const parts = [...baseParts, ...target.split("/")];
  const normalized: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      normalized.pop();
      continue;
    }

    normalized.push(part);
  }

  return normalized.join("/");
}

function slideRelationshipPath(slidePath: string): string {
  const parts = slidePath.split("/");
  const fileName = parts.pop();

  return `${parts.join("/")}/_rels/${fileName}.rels`;
}

function imageContentType(path: string): string {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith(".png")) {
    return "image/png";
  }

  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lowerPath.endsWith(".gif")) {
    return "image/gif";
  }

  if (lowerPath.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (lowerPath.endsWith(".webp")) {
    return "image/webp";
  }

  return "application/octet-stream";
}

function textFromShape(shape: Element): string {
  const textBody = firstDescendant(shape, "txBody");
  if (!textBody) {
    return "";
  }

  return descendants(textBody, "p")
    .map((paragraph) =>
      descendants(paragraph, "t")
        .map((text) => text.textContent ?? "")
        .join("")
        .trim()
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function fontSizeFromShape(shape: Element): number | null {
  const runProperties = firstDescendant(shape, "rPr");
  const size = parseInteger(runProperties?.getAttribute("sz") ?? null);

  return size ? Math.max(9, size / 100) : null;
}

function textColorFromShape(shape: Element): string | null {
  const runProperties = firstDescendant(shape, "rPr");

  return solidFillColor(runProperties);
}

async function parsePptxDeck(
  buffer: ArrayBuffer,
  registerBlobUrl: (url: string) => void
): Promise<PptxDeck> {
  const zip = ZipArchive.from(buffer);
  const presentationXml = parseXml(
    await zip.readText("ppt/presentation.xml"),
    "ppt/presentation.xml"
  );
  const deckSize = parseSlideSize(presentationXml);
  const presentationRelationships = parseRelationships(
    await zip.readText("ppt/_rels/presentation.xml.rels")
  );
  const slideIds = descendants(presentationXml, "sldId");
  const slidePaths =
    slideIds.length > 0
      ? slideIds
          .map((slideId) => {
            const relationshipId =
              slideId.getAttributeNS(RELATIONSHIP_NS, "id") ??
              slideId.getAttribute("r:id");
            const target = relationshipId
              ? presentationRelationships.get(relationshipId)
              : null;

            return target ? normalizeZipPath("ppt/presentation.xml", target) : null;
          })
          .filter((path): path is string => Boolean(path))
      : zip
          .list()
          .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const slides: PptxSlide[] = [];

  for (const [slideIndex, slidePath] of slidePaths.entries()) {
    const slideXml = parseXml(await zip.readText(slidePath), slidePath);
    const relationshipFile = slideRelationshipPath(slidePath);
    const slideRelationships = zip.list().includes(relationshipFile)
      ? parseRelationships(await zip.readText(relationshipFile))
      : new Map<string, string>();
    const background = solidFillColor(firstDescendant(slideXml, "bgPr")) ?? "#ffffff";
    const textBoxes = descendants(slideXml, "sp")
      .map((shape, shapeIndex): PptxTextBox | null => {
        const text = textFromShape(shape);
        if (!text) {
          return null;
        }

        return {
          color: textColorFromShape(shape),
          fill: solidFillColor(directChild(shape, "spPr")),
          fontSize: fontSizeFromShape(shape),
          frame: parseFrame(shape, deckSize, shapeIndex),
          id: `${slidePath}:text:${shapeIndex}`,
          text,
        };
      })
      .filter((box): box is PptxTextBox => Boolean(box));
    const images: PptxImage[] = [];

    for (const [imageIndex, picture] of descendants(slideXml, "pic").entries()) {
      const blip = firstDescendant(picture, "blip");
      const relationshipId =
        blip?.getAttributeNS(RELATIONSHIP_NS, "embed") ??
        blip?.getAttribute("r:embed");
      const target = relationshipId ? slideRelationships.get(relationshipId) : null;

      if (!target) {
        continue;
      }

      const imagePath = normalizeZipPath(slidePath, target);
      const imageBytes = await zip.readBytes(imagePath);
      const url = URL.createObjectURL(
        new Blob([toArrayBuffer(imageBytes)], { type: imageContentType(imagePath) })
      );
      registerBlobUrl(url);
      images.push({
        frame: parseFrame(picture, deckSize, imageIndex),
        id: `${slidePath}:image:${imageIndex}`,
        url,
      });
    }

    slides.push({
      background,
      id: slidePath,
      images,
      textBoxes,
      title:
        textBoxes
          .map((box) => box.text.split("\n")[0]?.trim())
          .find(Boolean) ?? `슬라이드 ${slideIndex + 1}`,
    });
  }

  if (slides.length === 0) {
    throw new Error("PPTX 안에서 슬라이드를 찾지 못했습니다.");
  }

  return {
    ...deckSize,
    slides,
  };
}

function isPptxFile(name: string, contentType?: string | null): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === PPTX_CONTENT_TYPE ||
    name.toLowerCase().endsWith(".pptx")
  );
}

function clampPercent(value: number): number {
  return Math.max(-10, Math.min(110, value));
}

export function PptxArtifactPreview(props: {
  contentType?: string | null;
  downloadHref: string;
  name: string;
}) {
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ready"; deck: PptxDeck }
    | { kind: "error"; message: string }
    | { kind: "unsupported" }
  >(isPptxFile(props.name, props.contentType) ? { kind: "loading" } : { kind: "unsupported" });
  const [slideIndex, setSlideIndex] = React.useState(0);

  React.useEffect(() => {
    if (!isPptxFile(props.name, props.contentType)) {
      setState({ kind: "unsupported" });
      return;
    }

    const controller = new AbortController();
    const blobUrls: string[] = [];

    setSlideIndex(0);
    setState({ kind: "loading" });
    fetch(props.downloadHref, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const deck = await parsePptxDeck(await response.arrayBuffer(), (url) => {
          blobUrls.push(url);
        });
        setState({ kind: "ready", deck });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "PPTX 미리보기를 불러오지 못했습니다.",
        });
      });

    return () => {
      controller.abort();
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [props.contentType, props.downloadHref, props.name]);

  if (state.kind === "unsupported") {
    return (
      <div className="flex h-full min-h-[26rem] items-center justify-center rounded-2xl border border-border bg-card px-6 text-center text-body-md leading-6 text-muted-foreground">
        구형 `.ppt` 파일은 브라우저 내장 뷰어로 안전하게 렌더링할 수 없습니다. `.pptx`로 저장하면 이 화면에서 바로 볼 수 있습니다.
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="flex h-full min-h-[26rem] items-center justify-center rounded-2xl border border-border bg-card px-6 text-center text-body-md text-muted-foreground">
        PPTX 슬라이드를 불러오는 중입니다.
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex h-full min-h-[26rem] items-center justify-center rounded-2xl border border-border bg-card px-6 text-center text-body-md leading-6 text-muted-foreground">
        PPTX 미리보기를 불러오지 못했습니다. {state.message}
      </div>
    );
  }

  const deck = state.deck;
  const slide = deck.slides[Math.min(slideIndex, deck.slides.length - 1)];

  return (
    <div className="flex h-full min-h-[28rem] flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-body-sm font-semibold text-foreground">
            {slide.title}
          </div>
          <div className="text-label-md text-muted-foreground">
            {slideIndex + 1} / {deck.slides.length}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={slideIndex === 0}
            onClick={() => setSlideIndex((current) => Math.max(0, current - 1))}
          >
            이전
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={slideIndex >= deck.slides.length - 1}
            onClick={() =>
              setSlideIndex((current) => Math.min(deck.slides.length - 1, current + 1))
            }
          >
            다음
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-secondary p-4">
        <div
          className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-border shadow-sm"
          style={{
            aspectRatio: `${deck.width} / ${deck.height}`,
            backgroundColor: slide.background,
          }}
        >
          {slide.images.map((image) => (
            <img
              key={image.id}
              src={image.url}
              alt=""
              className="absolute object-contain"
              style={{
                height: `${clampPercent(image.frame.height)}%`,
                left: `${clampPercent(image.frame.x)}%`,
                top: `${clampPercent(image.frame.y)}%`,
                width: `${clampPercent(image.frame.width)}%`,
              }}
            />
          ))}
          {slide.textBoxes.map((box) => (
            <div
              key={box.id}
              className="absolute overflow-hidden whitespace-pre-wrap rounded-md px-2 py-1 leading-tight"
              style={{
                backgroundColor: box.fill ? `${box.fill}dd` : "transparent",
                color: box.color ?? "#111827",
                fontSize: box.fontSize ? `${box.fontSize}px` : undefined,
                height: `${clampPercent(box.frame.height)}%`,
                left: `${clampPercent(box.frame.x)}%`,
                top: `${clampPercent(box.frame.y)}%`,
                width: `${clampPercent(box.frame.width)}%`,
              }}
            >
              {box.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
