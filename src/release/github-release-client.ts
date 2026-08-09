import type {
  GitHubReleaseAssetSnapshot,
  GitHubReleaseClient,
  GitHubReleaseSnapshot,
  ReleaseAssetInput,
} from "./github-release-coordinator.js";

export interface GitHubReleaseClientOptions {
  repositoryFullName: string;
  token: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  uploadsBaseUrl?: string;
}

interface GitHubReleaseApiPayload {
  id?: number;
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  upload_url?: string;
  assets?: Array<{
    id?: number;
    name?: string;
    size?: number;
    digest?: string | null;
  }>;
}

export function createGitHubReleaseClient(
  options: GitHubReleaseClientOptions
): GitHubReleaseClient {
  const token = options.token.trim();
  if (!token) {
    throw new Error(
      `GitHub release client for ${options.repositoryFullName} requires a GitHub token.`
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/u, "");
  const uploadsBaseUrl = (
    options.uploadsBaseUrl ?? "https://uploads.github.com"
  ).replace(/\/$/u, "");
  const uploadUrls = new Map<number, string>();

  return {
    async findByTag(tag) {
      const response = await request(
        `${apiBaseUrl}/repos/${options.repositoryFullName}/releases/tags/${encodeURIComponent(tag)}`,
        { method: "GET" }
      );
      if (response.status === 404) {
        return null;
      }
      return readRelease(response, uploadUrls);
    },

    async createDraft(input) {
      const response = await request(
        `${apiBaseUrl}/repos/${options.repositoryFullName}/releases`,
        {
          method: "POST",
          body: JSON.stringify({
            tag_name: input.tagName,
            name: input.name,
            body: input.body,
            draft: true,
            prerelease: false,
            ...(input.targetCommitish
              ? { target_commitish: input.targetCommitish }
              : {}),
          }),
        }
      );
      return readRelease(response, uploadUrls);
    },

    async uploadAsset(releaseId, asset) {
      const baseUploadUrl =
        uploadUrls.get(releaseId) ??
        `${uploadsBaseUrl}/repos/${options.repositoryFullName}/releases/${releaseId}/assets`;
      const uploadUrl = baseUploadUrl.replace(/\{[^}]+\}$/u, "");
      const response = await request(
        `${uploadUrl}?name=${encodeURIComponent(asset.name)}`,
        {
          method: "POST",
          body: Buffer.from(asset.bytes),
          contentType: contentTypeForAsset(asset.name),
        }
      );
      const payload = await readJson(response);
      return mapAsset(payload as GitHubReleaseApiPayload["assets"][number]);
    },

    async publishRelease(releaseId) {
      const response = await request(
        `${apiBaseUrl}/repos/${options.repositoryFullName}/releases/${releaseId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ draft: false }),
        }
      );
      return readRelease(response, uploadUrls);
    },
  };

  async function request(
    url: string,
    input: {
      method: string;
      body?: BodyInit | null;
      contentType?: string;
    }
  ): Promise<Response> {
    const response = await fetchImpl(url, {
      method: input.method,
      body: input.body,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(input.body && input.contentType
          ? { "Content-Type": input.contentType }
          : input.body
            ? { "Content-Type": "application/json" }
            : {}),
      },
    });

    if (!response.ok && response.status !== 404) {
      const message = await response.text();
      throw new Error(
        `GitHub release request failed with HTTP ${response.status}: ${message.slice(0, 240)}`
      );
    }
    return response;
  }
}

async function readRelease(
  response: Response,
  uploadUrls: Map<number, string>
): Promise<GitHubReleaseSnapshot> {
  const payload = (await readJson(response)) as GitHubReleaseApiPayload;
  const release = mapRelease(payload);
  if (release.uploadUrl) {
    uploadUrls.set(release.id, release.uploadUrl);
  }
  return release;
}

async function readJson(response: Response): Promise<unknown> {
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("GitHub release response was not a JSON object.");
  }
  return payload;
}

function mapRelease(payload: GitHubReleaseApiPayload): GitHubReleaseSnapshot {
  if (
    !Number.isInteger(payload.id) ||
    typeof payload.tag_name !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.body !== "string" ||
    typeof payload.draft !== "boolean" ||
    typeof payload.prerelease !== "boolean"
  ) {
    throw new Error("GitHub release response is missing required release fields.");
  }

  return {
    id: payload.id,
    tagName: payload.tag_name,
    name: payload.name,
    body: payload.body,
    draft: payload.draft,
    prerelease: payload.prerelease,
    uploadUrl: payload.upload_url,
    assets: (payload.assets ?? []).map(mapAsset),
  };
}

function mapAsset(
  payload: GitHubReleaseApiPayload["assets"][number] | undefined
): GitHubReleaseAssetSnapshot {
  if (
    !payload ||
    !Number.isInteger(payload.id) ||
    typeof payload.name !== "string" ||
    !Number.isInteger(payload.size)
  ) {
    throw new Error("GitHub release asset response is missing required fields.");
  }
  return {
    id: payload.id,
    name: payload.name,
    size: payload.size,
    digest: payload.digest ?? null,
  };
}

function contentTypeForAsset(name: string): string {
  return name.toLowerCase().endsWith(".txt")
    ? "text/plain"
    : "application/octet-stream";
}
