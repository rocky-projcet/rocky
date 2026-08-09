import assert from "node:assert/strict";
import test from "node:test";

import {
  createGitHubReleaseClient,
  type GitHubReleaseClientOptions,
} from "../../src/release/github-release-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWithResponses(
  responses: Response[] = []
): { options: GitHubReleaseClientOptions; requests: Array<{ url: string; init?: RequestInit }> } {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  return {
    requests,
    options: {
      repositoryFullName: "rocky-projcet/rocky-release",
      token: "public-token",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        const response = responses.shift();
        if (!response) {
          throw new Error(`Unexpected request: ${url}`);
        }
        return response;
      },
    },
  };
}

const releasePayload = {
  id: 42,
  tag_name: "v0.1.4",
  name: "Rocky v0.1.4",
  body: "release notes",
  draft: true,
  prerelease: false,
  upload_url: "https://uploads.github.com/repos/rocky-projcet/rocky-release/releases/42/assets{?name,label}",
  assets: [],
};

test("GitHub release client returns null for a missing tag and authenticates API requests", async () => {
  const { options, requests } = clientWithResponses([jsonResponse({}, 404)]);
  const client = createGitHubReleaseClient(options);

  assert.equal(await client.findByTag("v0.1.4"), null);
  assert.equal(
    requests[0]?.url,
    "https://api.github.com/repos/rocky-projcet/rocky-release/releases/tags/v0.1.4"
  );
  assert.equal(
    new Headers(requests[0]?.init?.headers).get("authorization"),
    "Bearer public-token"
  );
});

test("GitHub release client creates drafts, uploads bytes, and publishes a release", async () => {
  const { options, requests } = clientWithResponses([
    jsonResponse(releasePayload),
    jsonResponse({
      id: 7,
      name: "SHA256SUMS.txt",
      size: 3,
      digest: "sha256:abc",
    }),
    jsonResponse({ ...releasePayload, draft: false }),
  ]);
  const client = createGitHubReleaseClient(options);

  const draft = await client.createDraft({
    tagName: "v0.1.4",
    name: "Rocky v0.1.4",
    body: "release notes",
    targetCommitish: "main",
  });
  const uploaded = await client.uploadAsset(42, {
    name: "SHA256SUMS.txt",
    bytes: new TextEncoder().encode("abc"),
    sha256: "abc",
  });
  const published = await client.publishRelease(42);

  assert.equal(draft.id, 42);
  assert.equal(uploaded.digest, "sha256:abc");
  assert.equal(published.draft, false);
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    tag_name: "v0.1.4",
    name: "Rocky v0.1.4",
    body: "release notes",
    draft: true,
    prerelease: false,
    target_commitish: "main",
  });
  assert.equal(requests[1]?.url, "https://uploads.github.com/repos/rocky-projcet/rocky-release/releases/42/assets?name=SHA256SUMS.txt");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.equal(new Headers(requests[1]?.init?.headers).get("content-type"), "text/plain");
  assert.equal(requests[2]?.init?.method, "PATCH");
});

test("GitHub release client requires a non-empty token", () => {
  assert.throws(
    () =>
      createGitHubReleaseClient({
        repositoryFullName: "rocky-projcet/rocky-release",
        token: "",
      }),
    /requires a GitHub token/u
  );
});
