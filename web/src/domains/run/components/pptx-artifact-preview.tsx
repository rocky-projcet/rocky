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

interface PptxTextStyle {
  bold: boolean | null;
  color: string | null;
  fontFamily: string | null;
  fontSize: number | null;
  italic: boolean | null;
  underline: boolean | null;
}

interface PptxTextRun extends PptxTextStyle {
  id: string;
  text: string;
}

interface PptxParagraph {
  align: React.CSSProperties["textAlign"] | null;
  id: string;
  runs: PptxTextRun[];
}

interface PptxLine {
  color: string;
  width: number;
}

interface PptxInsets {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface PptxPlaceholderKey {
  idx: string | null;
  type: string;
}

interface PptxPlaceholder {
  align: React.CSSProperties["textAlign"] | null;
  fill: string | null;
  frame: SlideFrame | null;
  key: PptxPlaceholderKey;
  line: PptxLine | null;
  textStyle: PptxTextStyle;
}

interface PptxTextBox {
  align: React.CSSProperties["textAlign"] | null;
  fill: string | null;
  geometry: string | null;
  insets: PptxInsets;
  line: PptxLine | null;
  fontSize: number | null;
  frame: SlideFrame;
  id: string;
  order: number;
  paragraphs: PptxParagraph[];
  rotation: number;
  text: string;
}

interface PptxShape {
  fill: string | null;
  frame: SlideFrame;
  geometry: string | null;
  id: string;
  line: PptxLine | null;
  order: number;
  rotation: number;
}

interface PptxImage {
  frame: SlideFrame;
  id: string;
  order: number;
  url: string;
}

interface PptxSlide {
  background: string;
  id: string;
  images: PptxImage[];
  shapes: PptxShape[];
  textBoxes: PptxTextBox[];
  title: string;
}

interface PptxDeck {
  height: number;
  slides: PptxSlide[];
  width: number;
}

type SlideLayer =
  | { kind: "image"; image: PptxImage; order: number }
  | { kind: "shape"; order: number; shape: PptxShape }
  | { kind: "text"; order: number; textBox: PptxTextBox };

interface RelationshipTarget {
  target: string;
  type: string | null;
}

interface PptxTheme {
  colors: Map<string, string>;
  majorFont: string | null;
  minorFont: string | null;
}

const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const RELATIONSHIP_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const EMU_PER_POINT = 12_700;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const DEFAULT_TEXT_STYLE: PptxTextStyle = {
  bold: null,
  color: null,
  fontFamily: null,
  fontSize: null,
  italic: null,
  underline: null,
};
const DEFAULT_THEME: PptxTheme = {
  colors: new Map([
    ["dk1", "#000000"],
    ["lt1", "#ffffff"],
    ["dk2", "#1f2937"],
    ["lt2", "#f8fafc"],
    ["accent1", "#4472c4"],
    ["accent2", "#ed7d31"],
    ["accent3", "#a5a5a5"],
    ["accent4", "#ffc000"],
    ["accent5", "#5b9bd5"],
    ["accent6", "#70ad47"],
    ["hlink", "#0563c1"],
    ["folHlink", "#954f72"],
    ["bg1", "#ffffff"],
    ["tx1", "#000000"],
    ["bg2", "#f8fafc"],
    ["tx2", "#1f2937"],
  ]),
  majorFont: "Aptos Display",
  minorFont: "Aptos",
};

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

function hexToRgb(color: string): { b: number; g: number; r: number } | null {
  const normalized = color.startsWith("#") ? color.slice(1) : color;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToCssColor(
  rgb: { b: number; g: number; r: number },
  alpha: number | null
): string {
  const r = Math.max(0, Math.min(255, Math.round(rgb.r)));
  const g = Math.max(0, Math.min(255, Math.round(rgb.g)));
  const b = Math.max(0, Math.min(255, Math.round(rgb.b)));

  if (alpha !== null && alpha < 0.999) {
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
  }

  return `#${[r, g, b]
    .map((component) => component.toString(16).padStart(2, "0"))
    .join("")}`;
}

function colorTransformValue(element: Element, localName: string): number | null {
  const transform = directChild(element, localName);
  const value = parseInteger(transform?.getAttribute("val") ?? null);

  return value === null ? null : value / 100_000;
}

function applyColorTransforms(color: string, colorElement: Element): string {
  const rgb = hexToRgb(color);

  if (!rgb) {
    return color;
  }

  const shade = colorTransformValue(colorElement, "shade");
  const tint = colorTransformValue(colorElement, "tint");
  const lumMod = colorTransformValue(colorElement, "lumMod");
  const lumOff = colorTransformValue(colorElement, "lumOff");
  const alpha = colorTransformValue(colorElement, "alpha");
  let transformed = { ...rgb };

  if (shade !== null) {
    transformed = {
      r: transformed.r * shade,
      g: transformed.g * shade,
      b: transformed.b * shade,
    };
  }

  if (tint !== null) {
    transformed = {
      r: transformed.r + (255 - transformed.r) * tint,
      g: transformed.g + (255 - transformed.g) * tint,
      b: transformed.b + (255 - transformed.b) * tint,
    };
  }

  if (lumMod !== null || lumOff !== null) {
    const mod = lumMod ?? 1;
    const off = lumOff ?? 0;
    transformed = {
      r: transformed.r * mod + 255 * off,
      g: transformed.g * mod + 255 * off,
      b: transformed.b * mod + 255 * off,
    };
  }

  return rgbToCssColor(transformed, alpha);
}

function firstColorElement(element: Element | null | undefined): Element | null {
  if (!element) {
    return null;
  }

  return (
    directChild(element, "srgbClr") ??
    directChild(element, "schemeClr") ??
    directChild(element, "sysClr") ??
    directChild(element, "prstClr") ??
    firstDescendant(element, "srgbClr") ??
    firstDescendant(element, "schemeClr") ??
    firstDescendant(element, "sysClr") ??
    firstDescendant(element, "prstClr")
  );
}

function colorFromColorElement(
  colorElement: Element | null | undefined,
  theme: PptxTheme
): string | null {
  if (!colorElement) {
    return null;
  }

  let color: string | null = null;

  if (colorElement.localName === "srgbClr") {
    color = parseColor(colorElement.getAttribute("val"));
  }

  if (colorElement.localName === "sysClr") {
    color =
      parseColor(colorElement.getAttribute("lastClr")) ??
      parseColor(colorElement.getAttribute("val"));
  }

  if (colorElement.localName === "schemeClr") {
    const schemeName = colorElement.getAttribute("val") ?? "";
    color = theme.colors.get(schemeName) ?? null;
  }

  if (colorElement.localName === "prstClr") {
    color = presetColor(colorElement.getAttribute("val"));
  }

  return color ? applyColorTransforms(color, colorElement) : null;
}

function presetColor(value: string | null): string | null {
  switch (value) {
    case "black":
      return "#000000";
    case "blue":
      return "#0000ff";
    case "cyan":
      return "#00ffff";
    case "green":
      return "#008000";
    case "magenta":
      return "#ff00ff";
    case "red":
      return "#ff0000";
    case "white":
      return "#ffffff";
    case "yellow":
      return "#ffff00";
    default:
      return null;
  }
}

function solidFillColor(
  element: Element | null | undefined,
  theme: PptxTheme = DEFAULT_THEME
): string | null {
  if (!element || directChild(element, "noFill")) {
    return null;
  }

  const solidFill = directChild(element, "solidFill");

  return colorFromColorElement(firstColorElement(solidFill), theme);
}

function rawSchemeColor(element: Element | null | undefined): string | null {
  const colorElement = firstColorElement(element);

  if (!colorElement) {
    return null;
  }

  if (colorElement.localName === "srgbClr") {
    return parseColor(colorElement.getAttribute("val"));
  }

  if (colorElement.localName === "sysClr") {
    return (
      parseColor(colorElement.getAttribute("lastClr")) ??
      parseColor(colorElement.getAttribute("val"))
    );
  }

  if (colorElement.localName === "prstClr") {
    return presetColor(colorElement.getAttribute("val"));
  }

  return null;
}

function parseTheme(themeXml: string): PptxTheme {
  const doc = parseXml(themeXml, "ppt/theme/theme.xml");
  const colors = new Map(DEFAULT_THEME.colors);
  const colorScheme = firstDescendant(doc, "clrScheme");

  for (const entry of Array.from(colorScheme?.children ?? [])) {
    const color = rawSchemeColor(entry);

    if (color) {
      colors.set(entry.localName, color);
    }
  }

  const aliasPairs: Array<[string, string]> = [
    ["bg1", "lt1"],
    ["tx1", "dk1"],
    ["bg2", "lt2"],
    ["tx2", "dk2"],
  ];

  for (const [alias, source] of aliasPairs) {
    const color = colors.get(source);

    if (color) {
      colors.set(alias, color);
    }
  }

  const fontScheme = firstDescendant(doc, "fontScheme");
  const majorFont = directChild(firstDescendant(fontScheme, "majorFont"), "latin")?.getAttribute(
    "typeface"
  );
  const minorFont = directChild(firstDescendant(fontScheme, "minorFont"), "latin")?.getAttribute(
    "typeface"
  );

  return {
    colors,
    majorFont: majorFont || DEFAULT_THEME.majorFont,
    minorFont: minorFont || DEFAULT_THEME.minorFont,
  };
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

function readFrame(
  element: Element,
  deckSize: { height: number; width: number }
): SlideFrame | null {
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

  return null;
}

function parseFrame(
  element: Element,
  deckSize: { height: number; width: number },
  fallbackIndex: number,
  fallbackFrame: SlideFrame | null = null
): SlideFrame {
  const frame = readFrame(element, deckSize);

  if (frame) {
    return frame;
  }

  if (fallbackFrame) {
    return fallbackFrame;
  }

  return {
    height: fallbackIndex === 0 ? 14 : 12,
    width: 82,
    x: 9,
    y: 9 + fallbackIndex * 13,
  };
}

function parseRelationships(xml: string): Map<string, RelationshipTarget> {
  const doc = parseXml(xml, "relationships");
  const relationshipById = new Map<string, RelationshipTarget>();

  for (const relationship of descendants(doc, "Relationship")) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");

    if (id && target) {
      relationshipById.set(id, {
        target,
        type: relationship.getAttribute("Type"),
      });
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
  return textParagraphsFromShape(shape)
    .map((paragraph) => paragraph.text)
    .filter((text) => text.trim())
    .join("\n")
    .trim();
}

function textParagraphsFromShape(shape: Element): Array<{ element: Element; text: string }> {
  const textBody = firstDescendant(shape, "txBody");

  if (!textBody) {
    return [];
  }

  return Array.from(textBody.children)
    .filter((entry) => entry.localName === "p")
    .map((paragraph) => ({
      element: paragraph,
      text: Array.from(paragraph.children)
        .map((child) => {
          if (child.localName === "br") {
            return "\n";
          }

          if (child.localName !== "r" && child.localName !== "fld") {
            return "";
          }

          return descendants(child, "t")
            .map((text) => text.textContent ?? "")
            .join("");
        })
        .join(""),
    }));
}

function parseBooleanTextProperty(value: string | null): boolean | null {
  if (value === "1" || value === "true") {
    return true;
  }

  if (value === "0" || value === "false") {
    return false;
  }

  return null;
}

function mergeTextStyles(...styles: Array<Partial<PptxTextStyle> | null | undefined>): PptxTextStyle {
  const merged: PptxTextStyle = { ...DEFAULT_TEXT_STYLE };

  for (const style of styles) {
    if (!style) {
      continue;
    }

    for (const key of Object.keys(DEFAULT_TEXT_STYLE) as Array<keyof PptxTextStyle>) {
      if (style[key] !== undefined && style[key] !== null) {
        merged[key] = style[key] as never;
      }
    }
  }

  return merged;
}

function fontFamilyFromTypeface(typeface: string | null | undefined, theme: PptxTheme): string | null {
  if (!typeface) {
    return null;
  }

  if (typeface === "+mj-lt" || typeface === "+mj-ea" || typeface === "+mj-cs") {
    return theme.majorFont;
  }

  if (typeface === "+mn-lt" || typeface === "+mn-ea" || typeface === "+mn-cs") {
    return theme.minorFont;
  }

  return typeface;
}

function fontFamilyStackFromProperties(
  properties: Element | null | undefined,
  theme: PptxTheme
): string | null {
  if (!properties) {
    return null;
  }

  const candidates = [
    directChild(properties, "ea")?.getAttribute("typeface"),
    directChild(properties, "latin")?.getAttribute("typeface"),
    directChild(properties, "cs")?.getAttribute("typeface"),
  ]
    .map((typeface) => fontFamilyFromTypeface(typeface, theme))
    .filter((typeface): typeface is string => Boolean(typeface));
  const uniqueCandidates = [...new Set(candidates)];

  return uniqueCandidates.length > 0 ? uniqueCandidates.join(", ") : null;
}

function textStyleFromProperties(
  properties: Element | null | undefined,
  theme: PptxTheme
): Partial<PptxTextStyle> {
  if (!properties) {
    return {};
  }

  const size = parseInteger(properties.getAttribute("sz"));
  const fontFamily = fontFamilyStackFromProperties(properties, theme);
  const underline = properties.getAttribute("u");

  return {
    bold: parseBooleanTextProperty(properties.getAttribute("b")),
    color: solidFillColor(properties, theme),
    fontFamily,
    fontSize: size ? Math.max(6, size / 100) : null,
    italic: parseBooleanTextProperty(properties.getAttribute("i")),
    underline: underline && underline !== "none" ? true : null,
  };
}

function textStyleFromShapeStyle(shape: Element, theme: PptxTheme): Partial<PptxTextStyle> {
  const style = directChild(shape, "style");
  const fontRef = directChild(style, "fontRef");
  const index = fontRef?.getAttribute("idx");

  return {
    color: colorFromColorElement(firstColorElement(fontRef), theme),
    fontFamily:
      index === "major"
        ? theme.majorFont
        : index === "minor"
          ? theme.minorFont
          : null,
  };
}

function defaultTextStyleFromShape(shape: Element, theme: PptxTheme): PptxTextStyle {
  const textBody = firstDescendant(shape, "txBody");
  const listStyle = directChild(textBody, "lstStyle");
  const levelDefaults = firstDescendant(listStyle, "defRPr");
  const bodyDefaults = firstDescendant(textBody, "defRPr");
  const endParagraphDefaults = firstDescendant(textBody, "endParaRPr");

  return mergeTextStyles(
    {
      color: theme.colors.get("tx1") ?? "#111827",
      fontFamily: theme.minorFont,
    },
    textStyleFromShapeStyle(shape, theme),
    textStyleFromProperties(levelDefaults, theme),
    textStyleFromProperties(bodyDefaults, theme),
    textStyleFromProperties(endParagraphDefaults, theme)
  );
}

function paragraphAlignFromProperties(
  properties: Element | null | undefined
): React.CSSProperties["textAlign"] | null {
  switch (properties?.getAttribute("algn")) {
    case "ctr":
      return "center";
    case "r":
      return "right";
    case "just":
    case "dist":
      return "justify";
    case "l":
      return "left";
    default:
      return null;
  }
}

function parseTextParagraphs(
  shape: Element,
  theme: PptxTheme,
  inheritedStyle: PptxTextStyle,
  inheritedAlign: React.CSSProperties["textAlign"] | null
): PptxParagraph[] {
  return textParagraphsFromShape(shape)
    .map(({ element: paragraph, text }, paragraphIndex): PptxParagraph | null => {
      if (!text.trim()) {
        return null;
      }

      const paragraphProperties = directChild(paragraph, "pPr");
      const paragraphDefaultStyle = mergeTextStyles(
        inheritedStyle,
        textStyleFromProperties(directChild(paragraphProperties, "defRPr"), theme),
        textStyleFromProperties(directChild(paragraph, "endParaRPr"), theme)
      );
      const runs: PptxTextRun[] = [];

      for (const [runIndex, child] of Array.from(paragraph.children).entries()) {
        if (child.localName === "br") {
          runs.push({
            ...paragraphDefaultStyle,
            id: `${paragraphIndex}:break:${runIndex}`,
            text: "\n",
          });
          continue;
        }

        if (child.localName !== "r" && child.localName !== "fld") {
          continue;
        }

        const runText = descendants(child, "t")
          .map((textEntry) => textEntry.textContent ?? "")
          .join("");

        if (!runText) {
          continue;
        }

        runs.push({
          ...mergeTextStyles(
            paragraphDefaultStyle,
            textStyleFromProperties(directChild(child, "rPr"), theme)
          ),
          id: `${paragraphIndex}:run:${runIndex}`,
          text: runText,
        });
      }

      if (runs.length === 0) {
        runs.push({
          ...paragraphDefaultStyle,
          id: `${paragraphIndex}:run:fallback`,
          text,
        });
      }

      return {
        align: paragraphAlignFromProperties(paragraphProperties) ?? inheritedAlign,
        id: `paragraph:${paragraphIndex}`,
        runs,
      };
    })
    .filter((paragraph): paragraph is PptxParagraph => Boolean(paragraph));
}

function lineFromShape(shape: Element, theme: PptxTheme): PptxLine | null {
  const shapeProperties = directChild(shape, "spPr") ?? firstDescendant(shape, "spPr");
  const line = directChild(shapeProperties, "ln");

  if (!line || directChild(line, "noFill")) {
    return null;
  }

  const width = parseInteger(line.getAttribute("w"));
  const color =
    solidFillColor(line, theme) ??
    colorFromColorElement(firstColorElement(directChild(directChild(shape, "style"), "lnRef")), theme);

  if (!color) {
    return null;
  }

  return {
    color,
    width: width ? Math.max(1, width / EMU_PER_POINT) : 1,
  };
}

function geometryFromShape(shape: Element): string | null {
  const geometry = firstDescendant(directChild(shape, "spPr"), "prstGeom");

  return geometry?.getAttribute("prst") ?? null;
}

function insetsFromShape(shape: Element, deckSize: { height: number; width: number }): PptxInsets {
  const bodyProperties = firstDescendant(shape, "bodyPr");
  const left = parseInteger(bodyProperties?.getAttribute("lIns") ?? null) ?? 91_440;
  const right = parseInteger(bodyProperties?.getAttribute("rIns") ?? null) ?? 91_440;
  const top = parseInteger(bodyProperties?.getAttribute("tIns") ?? null) ?? 45_720;
  const bottom = parseInteger(bodyProperties?.getAttribute("bIns") ?? null) ?? 45_720;

  return {
    bottom: (bottom / deckSize.width) * 100,
    left: (left / deckSize.width) * 100,
    right: (right / deckSize.width) * 100,
    top: (top / deckSize.width) * 100,
  };
}

function rotationFromShape(shape: Element): number {
  const transform = firstDescendant(shape, "xfrm");
  const rotation = parseInteger(transform?.getAttribute("rot") ?? null);

  return rotation ? rotation / 60_000 : 0;
}

function placeholderKeyFromShape(shape: Element): PptxPlaceholderKey | null {
  const placeholder = firstDescendant(shape, "ph");

  if (!placeholder) {
    return null;
  }

  return {
    idx: placeholder.getAttribute("idx"),
    type: placeholder.getAttribute("type") ?? "body",
  };
}

function placeholderRank(candidate: PptxPlaceholder, key: PptxPlaceholderKey): number {
  if (candidate.key.idx && key.idx && candidate.key.idx === key.idx) {
    return 3;
  }

  if (candidate.key.type === key.type) {
    return 2;
  }

  if (candidate.key.type === "body" && key.type === "obj") {
    return 1;
  }

  return 0;
}

function findPlaceholder(
  placeholders: PptxPlaceholder[],
  key: PptxPlaceholderKey | null
): PptxPlaceholder | null {
  if (!key) {
    return null;
  }

  return placeholders
    .map((placeholder) => ({ placeholder, rank: placeholderRank(placeholder, key) }))
    .filter((entry) => entry.rank > 0)
    .sort((left, right) => right.rank - left.rank)[0]?.placeholder ?? null;
}

function collectPlaceholders(
  doc: XMLDocument,
  deckSize: { height: number; width: number },
  theme: PptxTheme
): PptxPlaceholder[] {
  return descendants(doc, "sp")
    .map((shape): PptxPlaceholder | null => {
      const key = placeholderKeyFromShape(shape);

      if (!key) {
        return null;
      }

      const defaultStyle = defaultTextStyleFromShape(shape, theme);
      const paragraphProperties = firstDescendant(shape, "pPr");

      return {
        align: paragraphAlignFromProperties(paragraphProperties),
        fill: solidFillColor(directChild(shape, "spPr"), theme),
        frame: readFrame(shape, deckSize),
        key,
        line: lineFromShape(shape, theme),
        textStyle: defaultStyle,
      };
    })
    .filter((placeholder): placeholder is PptxPlaceholder => Boolean(placeholder));
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
  const themeRelationship = [...presentationRelationships.values()].find((relationship) =>
    relationship.type?.endsWith("/theme")
  );
  const themePath = themeRelationship
    ? normalizeZipPath("ppt/presentation.xml", themeRelationship.target)
    : "ppt/theme/theme1.xml";
  const theme = zip.list().includes(themePath)
    ? parseTheme(await zip.readText(themePath))
    : DEFAULT_THEME;
  const slideIds = descendants(presentationXml, "sldId");
  const slidePaths =
    slideIds.length > 0
      ? slideIds
          .map((slideId) => {
            const relationshipId =
              slideId.getAttributeNS(RELATIONSHIP_NS, "id") ??
              slideId.getAttribute("r:id");
            const target = relationshipId
              ? presentationRelationships.get(relationshipId)?.target
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
      : new Map<string, RelationshipTarget>();
    const layoutRelationship = [...slideRelationships.values()].find((relationship) =>
      relationship.type?.endsWith("/slideLayout")
    );
    const layoutPath = layoutRelationship
      ? normalizeZipPath(slidePath, layoutRelationship.target)
      : null;
    const layoutXml =
      layoutPath && zip.list().includes(layoutPath)
        ? parseXml(await zip.readText(layoutPath), layoutPath)
        : null;
    const layoutRelationships =
      layoutPath && zip.list().includes(slideRelationshipPath(layoutPath))
        ? parseRelationships(await zip.readText(slideRelationshipPath(layoutPath)))
        : new Map<string, RelationshipTarget>();
    const masterRelationship = [...layoutRelationships.values()].find((relationship) =>
      relationship.type?.endsWith("/slideMaster")
    );
    const masterPath =
      layoutPath && masterRelationship
        ? normalizeZipPath(layoutPath, masterRelationship.target)
        : null;
    const masterXml =
      masterPath && zip.list().includes(masterPath)
        ? parseXml(await zip.readText(masterPath), masterPath)
        : null;
    const placeholders = [
      ...(layoutXml ? collectPlaceholders(layoutXml, deckSize, theme) : []),
      ...(masterXml ? collectPlaceholders(masterXml, deckSize, theme) : []),
    ];
    const background =
      solidFillColor(firstDescendant(slideXml, "bgPr"), theme) ??
      solidFillColor(firstDescendant(layoutXml, "bgPr"), theme) ??
      solidFillColor(firstDescendant(masterXml, "bgPr"), theme) ??
      theme.colors.get("bg1") ??
      "#ffffff";
    const shapes = descendants(slideXml, "sp")
      .map((shape, shapeIndex): PptxShape | null => {
        if (textFromShape(shape)) {
          return null;
        }

        const frame = readFrame(shape, deckSize);
        const fill = solidFillColor(directChild(shape, "spPr"), theme);
        const line = lineFromShape(shape, theme);

        if (!frame || (!fill && !line)) {
          return null;
        }

        return {
          fill,
          frame,
          geometry: geometryFromShape(shape),
          id: `${slidePath}:shape:${shapeIndex}`,
          line,
          order: shapeIndex,
          rotation: rotationFromShape(shape),
        };
      })
      .filter((shape): shape is PptxShape => Boolean(shape));
    const textBoxes = descendants(slideXml, "sp")
      .map((shape, shapeIndex): PptxTextBox | null => {
        const placeholder = findPlaceholder(placeholders, placeholderKeyFromShape(shape));
        const inheritedStyle = mergeTextStyles(
          placeholder?.textStyle,
          defaultTextStyleFromShape(shape, theme)
        );
        const inheritedAlign = placeholder?.align ?? null;
        const paragraphs = parseTextParagraphs(shape, theme, inheritedStyle, inheritedAlign);
        const text = paragraphs
          .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
          .join("\n")
          .trim();

        if (!text) {
          return null;
        }

        return {
          align: inheritedAlign,
          fill: solidFillColor(directChild(shape, "spPr"), theme) ?? placeholder?.fill ?? null,
          fontSize: inheritedStyle.fontSize,
          frame: parseFrame(shape, deckSize, shapeIndex, placeholder?.frame ?? null),
          geometry: geometryFromShape(shape),
          id: `${slidePath}:text:${shapeIndex}`,
          insets: insetsFromShape(shape, deckSize),
          line: lineFromShape(shape, theme) ?? placeholder?.line ?? null,
          order: shapeIndex,
          paragraphs,
          rotation: rotationFromShape(shape),
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
      const target = relationshipId ? slideRelationships.get(relationshipId)?.target : null;

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
        order: 10_000 + imageIndex,
        url,
      });
    }

    slides.push({
      background,
      id: slidePath,
      images,
      shapes,
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

function baseContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function clampPercent(value: number): number {
  return Math.max(-10, Math.min(110, value));
}

function fontSizeToContainerWidth(fontSize: number | null, deckWidth: number): string | undefined {
  if (!fontSize || deckWidth <= 0) {
    return undefined;
  }

  const deckWidthPoints = deckWidth / EMU_PER_POINT;

  return `${(fontSize / deckWidthPoints) * 100}cqw`;
}

function borderRadiusForGeometry(geometry: string | null): string | undefined {
  switch (geometry) {
    case "roundRect":
      return "1.4cqw";
    case "ellipse":
      return "9999px";
    default:
      return undefined;
  }
}

function cssFontFamily(fontFamily: string | null): string | undefined {
  if (!fontFamily) {
    return undefined;
  }

  const families = fontFamily
    .split(",")
    .map((family) => family.trim())
    .filter(Boolean)
    .map((family) => `"${family.replaceAll('"', "")}"`);

  return [...families, '"Apple SD Gothic Neo"', '"Noto Sans CJK KR"', "sans-serif"].join(", ");
}

function runStyle(
  run: PptxTextRun,
  deckWidth: number
): React.CSSProperties {
  return {
    color: run.color ?? undefined,
    fontFamily: cssFontFamily(run.fontFamily),
    fontSize: fontSizeToContainerWidth(run.fontSize, deckWidth),
    fontStyle: run.italic ? "italic" : undefined,
    fontWeight: run.bold ? 700 : undefined,
    textDecorationLine: run.underline ? "underline" : undefined,
  };
}

export function PptxArtifactPreview(props: {
  contentType?: string | null;
  downloadHref: string;
  name: string;
  previewHref?: string | null;
}) {
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ready"; deck: PptxDeck }
    | { kind: "error"; message: string }
    | { kind: "unsupported" }
  >(isPptxFile(props.name, props.contentType) ? { kind: "loading" } : { kind: "unsupported" });
  const [pdfPreviewState, setPdfPreviewState] = React.useState<
    | { kind: "disabled" }
    | { kind: "loading" }
    | { kind: "ready"; url: string }
    | { kind: "error"; message: string }
  >(props.previewHref ? { kind: "loading" } : { kind: "disabled" });
  const [slideIndex, setSlideIndex] = React.useState(0);

  React.useEffect(() => {
    if (!props.previewHref) {
      setPdfPreviewState({ kind: "disabled" });
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;

    setPdfPreviewState({ kind: "loading" });
    fetch(props.previewHref, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (baseContentType(contentType) !== "application/pdf") {
          throw new Error(`PDF 미리보기 응답이 아닙니다: ${contentType || "unknown"}`);
        }

        objectUrl = URL.createObjectURL(await response.blob());
        setPdfPreviewState({ kind: "ready", url: objectUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setPdfPreviewState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "PDF 변환 미리보기를 불러오지 못했습니다.",
        });
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [props.previewHref]);

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

  if (pdfPreviewState.kind === "loading") {
    return (
      <div className="flex h-full min-h-[26rem] items-center justify-center rounded-2xl border border-border bg-card px-6 text-center text-sm text-muted-foreground">
        PPT/PPTX를 PDF 미리보기로 변환하는 중입니다.
      </div>
    );
  }

  if (pdfPreviewState.kind === "ready") {
    return (
      <div className="h-full min-h-[28rem] overflow-hidden rounded-2xl border border-border bg-card">
        <object
          data={pdfPreviewState.url}
          type="application/pdf"
          className="h-full min-h-[28rem] w-full"
          aria-label={`${props.name} PDF 변환 미리보기`}
        >
          <div className="flex h-full min-h-[28rem] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            브라우저에서 PDF 인라인 미리보기를 지원하지 않습니다. 다운로드를 사용할 수 있습니다.
          </div>
        </object>
      </div>
    );
  }

  if (state.kind === "unsupported") {
    return (
      <div className="flex h-full min-h-[26rem] items-center justify-center rounded-2xl border border-border bg-card px-6 text-center text-sm leading-6 text-muted-foreground">
        구형 `.ppt` 파일은 브라우저 내장 뷰어로 안전하게 렌더링할 수 없습니다.
        {pdfPreviewState.kind === "error"
          ? ` PDF 변환도 실패했습니다. ${pdfPreviewState.message}`
          : " PDF 변환 미리보기를 사용할 수 있으면 이 화면에서 바로 볼 수 있습니다."}
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="flex h-full min-h-[26rem] items-center justify-center rounded-2xl border border-border bg-card px-6 text-center text-sm text-muted-foreground">
        PPTX 슬라이드를 불러오는 중입니다.
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex h-full min-h-[26rem] items-center justify-center rounded-2xl border border-border bg-card px-6 text-center text-sm leading-6 text-muted-foreground">
        PPTX 미리보기를 불러오지 못했습니다. {state.message}
      </div>
    );
  }

  const deck = state.deck;
  const slide = deck.slides[Math.min(slideIndex, deck.slides.length - 1)];
  const slideLayers: SlideLayer[] = [
    ...slide.shapes.map((shape) => ({ kind: "shape" as const, order: shape.order, shape })),
    ...slide.images.map((image) => ({ kind: "image" as const, image, order: image.order })),
    ...slide.textBoxes.map((textBox) => ({
      kind: "text" as const,
      order: textBox.order,
      textBox,
    })),
  ].sort((left, right) => left.order - right.order);

  return (
    <div className="flex h-full min-h-[28rem] flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">
            {slide.title}
          </div>
          <div className="text-xs text-muted-foreground">
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
          className="relative mx-auto w-full max-w-5xl overflow-hidden border border-border shadow-sm"
          style={{
            aspectRatio: `${deck.width} / ${deck.height}`,
            backgroundColor: slide.background,
            containerType: "inline-size",
          }}
        >
          {slideLayers.map((layer) => {
            if (layer.kind === "shape") {
              const { shape } = layer;

              return (
                <div
                  key={shape.id}
                  className="pointer-events-none absolute"
                  style={{
                    backgroundColor: shape.fill ?? "transparent",
                    border: shape.line
                      ? `${shape.line.width}px solid ${shape.line.color}`
                      : undefined,
                    borderRadius: borderRadiusForGeometry(shape.geometry),
                    boxSizing: "border-box",
                    height: `${clampPercent(shape.frame.height)}%`,
                    left: `${clampPercent(shape.frame.x)}%`,
                    top: `${clampPercent(shape.frame.y)}%`,
                    transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
                    transformOrigin: "center center",
                    width: `${clampPercent(shape.frame.width)}%`,
                  }}
                />
              );
            }

            if (layer.kind === "image") {
              const { image } = layer;

              return (
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
              );
            }

            const box = layer.textBox;

            return (
              <div
                key={box.id}
                className="absolute overflow-hidden whitespace-pre-wrap leading-tight"
                style={{
                  backgroundColor: box.fill ?? "transparent",
                  border: box.line
                    ? `${box.line.width}px solid ${box.line.color}`
                    : undefined,
                  borderRadius: borderRadiusForGeometry(box.geometry),
                  boxSizing: "border-box",
                  color: "#111827",
                  fontSize: fontSizeToContainerWidth(box.fontSize, deck.width),
                  height: `${clampPercent(box.frame.height)}%`,
                  left: `${clampPercent(box.frame.x)}%`,
                  paddingBottom: `${box.insets.bottom}cqw`,
                  paddingLeft: `${box.insets.left}cqw`,
                  paddingRight: `${box.insets.right}cqw`,
                  paddingTop: `${box.insets.top}cqw`,
                  top: `${clampPercent(box.frame.y)}%`,
                  transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
                  transformOrigin: "center center",
                  width: `${clampPercent(box.frame.width)}%`,
                }}
              >
                {box.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph.id}
                    className="m-0 min-h-[1em]"
                    style={{
                      textAlign: paragraph.align ?? box.align ?? undefined,
                    }}
                  >
                    {paragraph.runs.map((run) =>
                      run.text === "\n" ? (
                        <br key={run.id} />
                      ) : (
                        <span key={run.id} style={runStyle(run, deck.width)}>
                          {run.text}
                        </span>
                      )
                    )}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
