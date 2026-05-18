import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OFFICE_PREVIEW_CACHE_DIR = path.join(os.tmpdir(), "rocky-office-preview-cache");
const OFFICE_CONVERSION_TIMEOUT_MS = 90_000;
const FALLBACK_OFFICE_CONVERTERS = [
  "soffice",
  "libreoffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/opt/homebrew/bin/soffice",
  "/opt/homebrew/bin/libreoffice",
  "/usr/local/bin/soffice",
  "/usr/local/bin/libreoffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
];

function buildConverterInvocation(
  converter: string,
  args: string[]
): { file: string; args: string[]; shell: boolean } {
  if (process.platform !== "win32") {
    return { file: converter, args, shell: false };
  }

  const extension = path.extname(converter).toLowerCase();
  if (extension === ".ps1") {
    return {
      file: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", converter, ...args],
      shell: false,
    };
  }

  return {
    file: converter,
    args,
    shell: extension === ".cmd" || extension === ".bat",
  };
}

function officeConverterCandidates(): string[] {
  const configured = process.env.ROCKY_OFFICE_CONVERTER?.trim();

  return configured
    ? [
        configured,
        ...FALLBACK_OFFICE_CONVERTERS.filter((candidate) => candidate !== configured),
      ]
    : FALLBACK_OFFICE_CONVERTERS;
}

function conversionUnavailableError(lastError: unknown): Error & { statusCode: number } {
  const message = lastError instanceof Error ? lastError.message : String(lastError);

  return Object.assign(
    new Error(
      `PPT/PPTX PDF 변환기를 사용할 수 없습니다. LibreOffice를 설치하거나 ROCKY_OFFICE_CONVERTER를 설정하세요. 마지막 오류: ${message}`
    ),
    { statusCode: 503 }
  );
}

async function cachedPreviewPath(sourcePath: string): Promise<string> {
  const metadata = await stat(sourcePath);
  const key = createHash("sha256")
    .update(path.resolve(sourcePath))
    .update(String(metadata.size))
    .update(String(metadata.mtimeMs))
    .digest("hex");

  return path.join(
    OFFICE_PREVIEW_CACHE_DIR,
    key,
    `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`
  );
}

async function findGeneratedPdf(outDir: string, preferredPath: string): Promise<string> {
  try {
    const metadata = await stat(preferredPath);
    if (metadata.isFile()) {
      return preferredPath;
    }
  } catch {
    // LibreOffice usually uses the input basename, but some converters normalize names.
  }

  const entries = await readdir(outDir);
  const pdfEntry = entries.find((entry) => entry.toLowerCase().endsWith(".pdf"));

  if (!pdfEntry) {
    throw new Error("PDF 변환 결과 파일을 찾지 못했습니다.");
  }

  return path.join(outDir, pdfEntry);
}

export async function convertPresentationToPdfPreview(sourcePath: string): Promise<{
  body: Buffer;
  path: string;
}> {
  const outputPath = await cachedPreviewPath(sourcePath);
  const outDir = path.dirname(outputPath);

  try {
    return {
      body: await readFile(outputPath),
      path: outputPath,
    };
  } catch {
    // Cache miss; convert below.
  }

  await mkdir(outDir, { recursive: true });

  let lastError: unknown = null;
  for (const converter of officeConverterCandidates()) {
    try {
      const invocation = buildConverterInvocation(converter, [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        sourcePath,
      ]);
      await execFileAsync(
        invocation.file,
        invocation.args,
        {
          shell: invocation.shell,
          timeout: OFFICE_CONVERSION_TIMEOUT_MS,
          windowsHide: true,
        }
      );

      const generatedPath = await findGeneratedPdf(outDir, outputPath);
      return {
        body: await readFile(generatedPath),
        path: generatedPath,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw conversionUnavailableError(lastError);
}
