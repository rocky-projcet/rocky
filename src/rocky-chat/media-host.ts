import { readFile } from "node:fs/promises";
import path from "node:path";

export interface TemporaryMediaHostUploadInput {
  absolutePath: string;
  filename?: string | null;
  contentType?: string | null;
}

export interface TemporaryMediaHostUploadResult {
  provider: "tmpfiles";
  publicUrl: string;
  uploadedAt: string;
}

export interface TemporaryMediaHostLike {
  upload(input: TemporaryMediaHostUploadInput): Promise<TemporaryMediaHostUploadResult>;
}

export interface TmpfilesTemporaryMediaHostOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

const TMPFILES_UPLOAD_ENDPOINT = "https://tmpfiles.org/api/v1/upload";

function readNestedRecordString(
  value: unknown,
  keys: readonly string[]
): string | null {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim() ? current.trim() : null;
}

export function normalizeTmpfilesDownloadUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname.toLowerCase() !== "tmpfiles.org") {
    return url.toString();
  }

  url.protocol = "https:";
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "dl" && segments.length >= 2) {
    url.pathname = `/dl/${segments.join("/")}`;
  }

  return url.toString();
}

export class TmpfilesTemporaryMediaHost implements TemporaryMediaHostLike {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => string;

  constructor(options: TmpfilesTemporaryMediaHostOptions = {}) {
    this.endpoint = options.endpoint ?? TMPFILES_UPLOAD_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async upload(
    input: TemporaryMediaHostUploadInput
  ): Promise<TemporaryMediaHostUploadResult> {
    const bytes = await readFile(input.absolutePath);
    const body = new FormData();
    const blob = new Blob([new Uint8Array(bytes)], {
      type: input.contentType?.trim() || "application/octet-stream",
    });
    body.set("file", blob, input.filename?.trim() || path.basename(input.absolutePath));

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      body,
    });
    if (!response.ok) {
      throw new Error(`Temporary media upload failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as unknown;
    const uploadedUrl =
      readNestedRecordString(payload, ["data", "url"]) ??
      readNestedRecordString(payload, ["url"]);
    if (!uploadedUrl) {
      throw new Error("Temporary media upload response did not include a URL.");
    }

    return {
      provider: "tmpfiles",
      publicUrl: normalizeTmpfilesDownloadUrl(uploadedUrl),
      uploadedAt: this.now(),
    };
  }
}
