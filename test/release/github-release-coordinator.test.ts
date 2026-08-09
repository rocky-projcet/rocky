import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DualReleaseCoordinator,
  type GitHubReleaseClient,
  type GitHubReleaseSnapshot,
  type ReleaseAssetInput,
} from "../../src/release/github-release-coordinator.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function release(overrides: Partial<GitHubReleaseSnapshot> = {}): GitHubReleaseSnapshot {
  return {
    id: 1,
    tagName: "v0.1.4",
    name: "Rocky v0.1.4",
    body: "release notes",
    draft: true,
    prerelease: false,
    assets: [],
    ...overrides,
  };
}

class FakeReleaseClient implements GitHubReleaseClient {
  readonly calls: string[] = [];
  private nextId = 1;
  private current: GitHubReleaseSnapshot | null;
  private readonly timeline?: string[];

  constructor(
    private readonly label: string,
    initial: GitHubReleaseSnapshot | null = null,
    timeline?: string[]
  ) {
    this.current = initial;
    this.timeline = timeline;
  }

  async findByTag(): Promise<GitHubReleaseSnapshot | null> {
    this.record(`${this.label}:find`);
    return this.current;
  }

  async createDraft(input: {
    tagName: string;
    name: string;
    body: string;
    targetCommitish?: string;
  }): Promise<GitHubReleaseSnapshot> {
    this.record(`${this.label}:create`);
    this.current = release({
      id: this.nextId++,
      tagName: input.tagName,
      name: input.name,
      body: input.body,
    });
    return this.current;
  }

  async uploadAsset(
    _releaseId: number,
    asset: ReleaseAssetInput
  ): Promise<GitHubReleaseSnapshot["assets"][number]> {
    this.record(`${this.label}:upload:${asset.name}`);
    const uploaded = {
      id: this.nextId++,
      name: asset.name,
      size: asset.bytes.byteLength,
      digest: `sha256:${asset.sha256}`,
    };
    this.current = {
      ...this.current!,
      assets: [...this.current!.assets, uploaded],
    };
    return uploaded;
  }

  async publishRelease(releaseId: number): Promise<GitHubReleaseSnapshot> {
    this.record(`${this.label}:publish`);
    this.current = { ...this.current!, id: releaseId, draft: false };
    return this.current;
  }

  private record(call: string): void {
    this.calls.push(call);
    this.timeline?.push(call);
  }
}

const installer = new TextEncoder().encode("installer");
const checksums = new TextEncoder().encode("checksums");
const assets: ReleaseAssetInput[] = [
  {
    name: "Rocky-Setup-v0.1.4.exe",
    bytes: installer,
    sha256: sha256(installer),
  },
  {
    name: "SHA256SUMS.txt",
    bytes: checksums,
    sha256: sha256(checksums),
  },
];

test("dual release coordinator prepares both drafts before publishing private then public", async () => {
  const timeline: string[] = [];
  const privateClient = new FakeReleaseClient("private", null, timeline);
  const publicClient = new FakeReleaseClient("public", null, timeline);
  const result = await new DualReleaseCoordinator().publish({
    tag: "v0.1.4",
    name: "Rocky v0.1.4",
    body: "release notes",
    assets,
    privateClient,
    publicClient,
  });

  assert.deepEqual(timeline, [
    "private:find",
    "private:create",
    "private:upload:Rocky-Setup-v0.1.4.exe",
    "private:upload:SHA256SUMS.txt",
    "public:find",
    "public:create",
    "public:upload:Rocky-Setup-v0.1.4.exe",
    "public:upload:SHA256SUMS.txt",
    "private:publish",
    "public:publish",
  ]);
  assert.equal(result.privateRelease.draft, false);
  assert.equal(result.publicRelease.draft, false);
});

test("dual release coordinator resumes matching drafts without duplicate uploads", async () => {
  const matchingAssets = assets.map((asset, index) => ({
    id: index + 10,
    name: asset.name,
    size: asset.bytes.byteLength,
    digest: `sha256:${asset.sha256}`,
  }));
  const privateClient = new FakeReleaseClient(
    "private",
    release({ id: 10, assets: matchingAssets })
  );
  const publicClient = new FakeReleaseClient(
    "public",
    release({ id: 20, assets: matchingAssets })
  );

  await new DualReleaseCoordinator().publish({
    tag: "v0.1.4",
    name: "Rocky v0.1.4",
    body: "release notes",
    assets,
    privateClient,
    publicClient,
  });

  assert.deepEqual(privateClient.calls, ["private:find", "private:publish"]);
  assert.deepEqual(publicClient.calls, ["public:find", "public:publish"]);
});

test("dual release coordinator rejects an existing asset with a different digest", async () => {
  const privateClient = new FakeReleaseClient(
    "private",
    release({
      assets: [
        {
          id: 10,
          name: assets[0].name,
          size: assets[0].bytes.byteLength,
          digest: "sha256:wrong",
        },
      ],
    })
  );

  await assert.rejects(
    () =>
      new DualReleaseCoordinator().publish({
        tag: "v0.1.4",
        name: "Rocky v0.1.4",
        body: "release notes",
        assets,
        privateClient,
        publicClient: new FakeReleaseClient("public"),
      }),
    /asset Rocky-Setup-v0[.]1[.]4[.]exe does not match expected size or SHA-256/u
  );
  assert.deepEqual(privateClient.calls, ["private:find"]);
});

test("dual release coordinator rejects unexpected assets in an existing release", async () => {
  await assert.rejects(
    () =>
      new DualReleaseCoordinator().publish({
        tag: "v0.1.4",
        name: "Rocky v0.1.4",
        body: "release notes",
        assets: [...assets, { ...assets[0], name: "source.zip" }],
        privateClient: new FakeReleaseClient("private"),
        publicClient: new FakeReleaseClient("public"),
      }),
    /unexpected stable release assets/u
  );
});

test("dual release coordinator does not mutate a published release missing an asset", async () => {
  const privateClient = new FakeReleaseClient(
    "private",
    release({ draft: false })
  );

  await assert.rejects(
    () =>
      new DualReleaseCoordinator().publish({
        tag: "v0.1.4",
        name: "Rocky v0.1.4",
        body: "release notes",
        assets,
        privateClient,
        publicClient: new FakeReleaseClient("public"),
      }),
    /Published release v0[.]1[.]4 is missing expected asset/u
  );
  assert.deepEqual(privateClient.calls, ["private:find"]);
});
