import {
  fileToBase64,
  type RockyAttachmentInput,
  type RockyChatCreateInput,
} from "../../../shared/lib/agent-engine-client.js";

export type AgentTaskFileEncoder = (file: File) => Promise<string>;
export type AgentTaskPublicMediaUploader = (file: File) => Promise<string>;

const TMPFILES_UPLOAD_ENDPOINT = "https://tmpfiles.org/api/v1/upload";

const INSTAGRAM_PATTERN = /instagram|insta|\uC778\uC2A4\uD0C0|\uB9B4\uC2A4|reels?/iu;
const PUBLISH_PATTERN =
  /\uAC8C\uC2DC|\uBC1C\uD589|\uC5C5\uB85C\uB4DC|\uC62C\uB824|\uD3EC\uC2A4\uD305|publish|post|upload|reels?|feed/iu;
const PUBLIC_MEDIA_EXTENSION_PATTERN =
  /\.(?:avif|gif|heic|heif|jpe?g|m4v|mov|mp4|png|webm|webp)$/iu;

function readNestedRecordString(
  value: unknown,
  path: readonly string[]
): string | null {
  let current = value;
  for (const key of path) {
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

export async function uploadFileToTmpfiles(
  file: File,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const body = new FormData();
  body.set("file", file, file.name);

  const response = await fetcher(TMPFILES_UPLOAD_ENDPOINT, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error(`tmpfiles.org upload failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  const uploadedUrl =
    readNestedRecordString(payload, ["data", "url"]) ??
    readNestedRecordString(payload, ["url"]);
  if (!uploadedUrl) {
    throw new Error("tmpfiles.org upload response did not include a URL.");
  }

  return normalizeTmpfilesDownloadUrl(uploadedUrl);
}

export function isPublicMediaFile(file: File): boolean {
  const contentType = file.type.trim().toLowerCase();
  return (
    contentType.startsWith("image/") ||
    contentType.startsWith("video/") ||
    PUBLIC_MEDIA_EXTENSION_PATTERN.test(file.name)
  );
}

export function shouldCreateTmpfilesPublicMediaUrls(input: {
  message: string;
  skillId?: string | null;
  skillTitle?: string | null;
  skillInstructions?: string | null;
}): boolean {
  const instagramSignal = [
    input.message,
    input.skillId ?? "",
    input.skillTitle ?? "",
    input.skillInstructions ?? "",
  ].join("\n");
  const publishSignal = [
    input.message,
    input.skillId ?? "",
    input.skillTitle ?? "",
  ].join("\n");

  return (
    INSTAGRAM_PATTERN.test(instagramSignal) &&
    PUBLISH_PATTERN.test(publishSignal)
  );
}

export async function buildRockyAttachmentInputs(
  files: File[],
  encodeFile: AgentTaskFileEncoder = fileToBase64,
  options: {
    createPublicMediaUrls?: boolean;
    uploadPublicMediaFile?: AgentTaskPublicMediaUploader;
  } = {}
): Promise<RockyAttachmentInput[]> {
  const uploadPublicMediaFile =
    options.uploadPublicMediaFile ?? uploadFileToTmpfiles;

  return Promise.all(
    files.map(async (file) => {
      const publicUrl =
        options.createPublicMediaUrls && isPublicMediaFile(file)
          ? await uploadPublicMediaFile(file)
          : null;

      return {
        name: file.name,
        contentType: file.type || null,
        size: file.size,
        contentBase64: await encodeFile(file),
        ...(publicUrl ? { publicUrl } : {}),
      };
    })
  );
}

export async function buildAgentTaskChatInput({
  agentId,
  message,
  skillId,
  files,
  encodeFile,
  createPublicMediaUrls,
  uploadPublicMediaFile,
}: {
  agentId: string;
  message: string;
  skillId: string | null;
  files: File[];
  encodeFile?: AgentTaskFileEncoder;
  createPublicMediaUrls?: boolean;
  uploadPublicMediaFile?: AgentTaskPublicMediaUploader;
}): Promise<RockyChatCreateInput> {
  const attachments = await buildRockyAttachmentInputs(files, encodeFile, {
    createPublicMediaUrls,
    uploadPublicMediaFile,
  });

  return {
    message,
    agentId,
    skillId,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}
