import {
  assertStableReleaseAssetNames,
  type ReleaseTag,
  parseReleaseTag,
} from "./release-contracts.js";

export interface ReleaseAssetInput {
  name: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface GitHubReleaseAssetSnapshot {
  id: number;
  name: string;
  size: number;
  digest: string | null;
}

export interface GitHubReleaseSnapshot {
  id: number;
  tagName: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubReleaseAssetSnapshot[];
  uploadUrl?: string;
}

export interface GitHubReleaseClient {
  findByTag(tag: string): Promise<GitHubReleaseSnapshot | null>;
  createDraft(input: {
    tagName: string;
    name: string;
    body: string;
    targetCommitish?: string;
  }): Promise<GitHubReleaseSnapshot>;
  uploadAsset(
    releaseId: number,
    asset: ReleaseAssetInput
  ): Promise<GitHubReleaseAssetSnapshot>;
  publishRelease(releaseId: number): Promise<GitHubReleaseSnapshot>;
}

export interface DualReleaseInput {
  tag: string;
  name: string;
  body: string;
  assets: ReleaseAssetInput[];
  privateClient: GitHubReleaseClient;
  publicClient: GitHubReleaseClient;
  publicTargetCommitish?: string;
}

export interface DualReleaseResult {
  tag: ReleaseTag;
  privateRelease: GitHubReleaseSnapshot;
  publicRelease: GitHubReleaseSnapshot;
}

export class DualReleaseCoordinator {
  async publish(input: DualReleaseInput): Promise<DualReleaseResult> {
    const tag = parseReleaseTag(input.tag);
    assertStableReleaseAssetNames(
      input.assets.map((asset) => asset.name),
      tag.tag
    );

    const privateRelease = await this.prepareRelease(
      input.privateClient,
      input,
      undefined
    );
    const publicRelease = await this.prepareRelease(
      input.publicClient,
      input,
      input.publicTargetCommitish
    );

    const publishedPrivate = privateRelease.draft
      ? await input.privateClient.publishRelease(privateRelease.id)
      : privateRelease;
    const publishedPublic = publicRelease.draft
      ? await input.publicClient.publishRelease(publicRelease.id)
      : publicRelease;

    return {
      tag,
      privateRelease: publishedPrivate,
      publicRelease: publishedPublic,
    };
  }

  private async prepareRelease(
    client: GitHubReleaseClient,
    input: DualReleaseInput,
    targetCommitish: string | undefined
  ): Promise<GitHubReleaseSnapshot> {
    let release = await client.findByTag(input.tag);
    if (!release) {
      release = await client.createDraft({
        tagName: input.tag,
        name: input.name,
        body: input.body,
        targetCommitish,
      });
    }

    this.assertReleaseMetadata(release, input);
    this.assertKnownAssets(release, input.tag);

    for (const expected of input.assets) {
      const existing = release.assets.find((asset) => asset.name === expected.name);
      if (existing) {
        if (
          existing.size !== expected.bytes.byteLength ||
          normalizeDigest(existing.digest) !== expected.sha256.toLowerCase()
        ) {
          throw new Error(
            `Existing asset ${expected.name} does not match expected size or SHA-256.`
          );
        }
        continue;
      }

      const uploaded = await client.uploadAsset(release.id, expected);
      if (
        uploaded.name !== expected.name ||
        uploaded.size !== expected.bytes.byteLength ||
        normalizeDigest(uploaded.digest) !== expected.sha256.toLowerCase()
      ) {
        throw new Error(
          `Uploaded asset ${expected.name} does not match expected size or SHA-256.`
        );
      }
      release = {
        ...release,
        assets: [...release.assets, uploaded],
      };
    }

    return release;
  }

  private assertReleaseMetadata(
    release: GitHubReleaseSnapshot,
    input: DualReleaseInput
  ): void {
    if (
      release.tagName !== input.tag ||
      release.name !== input.name ||
      release.body !== input.body ||
      release.prerelease
    ) {
      throw new Error(
        `Existing release ${input.tag} has metadata that does not match the expected release.`
      );
    }
  }

  private assertKnownAssets(
    release: GitHubReleaseSnapshot,
    tag: string
  ): void {
    const expectedNames = new Set([
      ...Object.values({
        installer: `Rocky-Setup-${tag}.exe`,
        checksums: "SHA256SUMS.txt",
      }),
    ]);
    const unexpected = release.assets.find((asset) => !expectedNames.has(asset.name));
    if (unexpected) {
      throw new Error(
        `Existing release ${tag} contains unexpected stable release asset ${unexpected.name}.`
      );
    }
  }
}

function normalizeDigest(digest: string | null): string | null {
  if (!digest) {
    return null;
  }
  return digest.replace(/^sha256:/iu, "").toLowerCase();
}
