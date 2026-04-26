type ContentDispositionKind = "attachment" | "inline";

function fallbackFilename(filename: string): string {
  const fallback = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/["\\;]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return fallback || "download";
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function contentDispositionHeader(
  kind: ContentDispositionKind,
  filename: string
): string {
  return `${kind}; filename="${fallbackFilename(filename)}"; filename*=UTF-8''${encodeRfc5987Value(filename)}`;
}
