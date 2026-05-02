type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

export type XlsxPreviewSheet = {
  name: string;
  rows: string[][];
  rowCount: number;
  columnCount: number;
  truncatedRows: boolean;
  truncatedColumns: boolean;
};

export type XlsxPreviewWorkbook = {
  sheets: XlsxPreviewSheet[];
};

const XLSX_MAX_ROWS = 200;
const XLSX_MAX_COLUMNS = 50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

function readAscii(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);

  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("xlsx ZIP directory를 찾지 못했습니다.");
}

function readZipEntries(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map<string, ZipEntry>();

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("xlsx ZIP directory가 손상되었습니다.");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = readAscii(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.set(name, {
      name,
      method,
      compressedSize,
      localHeaderOffset,
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const DecompressionStreamCtor = globalThis.DecompressionStream as
    | (new (format: string) => DecompressionStream)
    | undefined;

  if (!DecompressionStreamCtor) {
    throw new Error("이 브라우저는 xlsx 압축 해제를 지원하지 않습니다.");
  }

  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const stream = new Blob([copy]).stream().pipeThrough(
    new DecompressionStreamCtor("deflate-raw")
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntryText(
  buffer: ArrayBuffer,
  entries: Map<string, ZipEntry>,
  name: string
): Promise<string | null> {
  const entry = entries.get(name);
  if (!entry) {
    return null;
  }

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`xlsx ZIP entry를 읽지 못했습니다: ${name}`);
  }

  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  const data =
    entry.method === 0
      ? compressed
      : entry.method === 8
        ? await inflateRaw(compressed)
        : null;

  if (!data) {
    throw new Error(`지원하지 않는 xlsx 압축 방식입니다: ${entry.method}`);
  }

  return readAscii(data);
}

function parseXml(text: string, name: string): Document {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`${name} XML을 읽지 못했습니다.`);
  }

  return document;
}

function elementsByLocalName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter(
    (element) => element.localName === localName
  );
}

function childText(element: Element, localName: string): string {
  return elementsByLocalName(element, localName)[0]?.textContent ?? "";
}

function relationshipId(element: Element): string {
  return (
    element.getAttribute("r:id") ??
    element.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id"
    ) ??
    ""
  );
}

function resolveWorkbookTarget(target: string): string {
  const rawPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];

  for (const part of rawPath.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

function columnIndexFromReference(reference: string): number | null {
  const letters = reference.match(/^[A-Za-z]+/)?.[0];
  if (!letters) {
    return null;
  }

  let value = 0;
  for (const letter of letters.toUpperCase()) {
    value = value * 26 + letter.charCodeAt(0) - 64;
  }

  return value - 1;
}

function cellValue(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute("t") ?? "";

  if (type === "inlineStr") {
    return elementsByLocalName(cell, "t")
      .map((entry) => entry.textContent ?? "")
      .join("");
  }

  const rawValue = childText(cell, "v");
  if (type === "s") {
    const sharedIndex = Number.parseInt(rawValue, 10);
    return Number.isFinite(sharedIndex) ? sharedStrings[sharedIndex] ?? rawValue : rawValue;
  }

  if (type === "b") {
    return rawValue === "1" ? "TRUE" : rawValue === "0" ? "FALSE" : rawValue;
  }

  if (!rawValue) {
    const formula = childText(cell, "f");
    return formula ? `=${formula}` : "";
  }

  return rawValue;
}

function parseSharedStrings(document: Document | null): string[] {
  if (!document) {
    return [];
  }

  return elementsByLocalName(document, "si").map((item) =>
    elementsByLocalName(item, "t")
      .map((entry) => entry.textContent ?? "")
      .join("")
  );
}

function parseSheet(
  document: Document,
  name: string,
  sharedStrings: string[]
): XlsxPreviewSheet {
  const rowElements = elementsByLocalName(document, "row");
  const rows: string[][] = [];
  let columnCount = 0;
  let truncatedColumns = false;

  for (const rowElement of rowElements.slice(0, XLSX_MAX_ROWS)) {
    const row: string[] = [];
    let fallbackColumnIndex = 0;

    for (const cell of elementsByLocalName(rowElement, "c")) {
      const reference = cell.getAttribute("r") ?? "";
      const columnIndex = columnIndexFromReference(reference) ?? fallbackColumnIndex;
      fallbackColumnIndex = columnIndex + 1;
      columnCount = Math.max(columnCount, columnIndex + 1);

      if (columnIndex >= XLSX_MAX_COLUMNS) {
        truncatedColumns = true;
        continue;
      }

      row[columnIndex] = cellValue(cell, sharedStrings);
    }

    rows.push(
      Array.from(
        { length: Math.min(columnCount, XLSX_MAX_COLUMNS) },
        (_, index) => row[index] ?? ""
      )
    );
  }

  return {
    name,
    rows,
    rowCount: rowElements.length,
    columnCount,
    truncatedRows: rowElements.length > XLSX_MAX_ROWS,
    truncatedColumns: truncatedColumns || columnCount > XLSX_MAX_COLUMNS,
  };
}

export async function parseXlsxPreview(
  buffer: ArrayBuffer
): Promise<XlsxPreviewWorkbook> {
  const entries = readZipEntries(buffer);
  const workbookText = await readZipEntryText(buffer, entries, "xl/workbook.xml");
  if (!workbookText) {
    throw new Error("xlsx workbook.xml을 찾지 못했습니다.");
  }

  const relationshipsText = await readZipEntryText(
    buffer,
    entries,
    "xl/_rels/workbook.xml.rels"
  );
  const sharedStringsText = await readZipEntryText(
    buffer,
    entries,
    "xl/sharedStrings.xml"
  );
  const workbookDocument = parseXml(workbookText, "workbook");
  const relationshipsDocument = relationshipsText
    ? parseXml(relationshipsText, "workbook relationships")
    : null;
  const sharedStrings = parseSharedStrings(
    sharedStringsText ? parseXml(sharedStringsText, "sharedStrings") : null
  );
  const relationshipTargets = new Map<string, string>();

  for (const relationship of relationshipsDocument
    ? elementsByLocalName(relationshipsDocument, "Relationship")
    : []) {
    const id = relationship.getAttribute("Id") ?? "";
    const target = relationship.getAttribute("Target") ?? "";
    if (id && target) {
      relationshipTargets.set(id, resolveWorkbookTarget(target));
    }
  }

  const sheets: XlsxPreviewSheet[] = [];
  for (const sheet of elementsByLocalName(workbookDocument, "sheet")) {
    const name = sheet.getAttribute("name") ?? `Sheet ${sheets.length + 1}`;
    const target = relationshipTargets.get(relationshipId(sheet));
    if (!target) {
      continue;
    }

    const sheetText = await readZipEntryText(buffer, entries, target);
    if (!sheetText) {
      continue;
    }

    sheets.push(parseSheet(parseXml(sheetText, name), name, sharedStrings));
  }

  return { sheets };
}
