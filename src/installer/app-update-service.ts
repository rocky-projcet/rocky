import { spawn as defaultSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  preservedInstallPathNames,
} from "./update-safety.js";

import type {
  AppUpdateAssetRecord,
  AppUpdateChecksumSource,
  AppUpdateRecord,
  AppUpdateServiceLike,
} from "./app-update-types.js";
import type { RuntimeChildProcess } from "../runtime/runtime-types.js";

interface AppUpdateSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["ignore", "ignore" | "pipe", "ignore" | "pipe"];
  detached?: boolean;
}

type AppUpdateSpawnLike = (
  command: string,
  args: string[],
  options: AppUpdateSpawnOptions
) => RuntimeChildProcess & { unref?: () => void };

type ChecksumTextFetcher = (url: string) => Promise<string>;

interface AppUpdateServiceOptions {
  stateRoot?: string;
  currentVersion?: string;
  platform?: NodeJS.Platform;
  repoFullName?: string;
  fetchImpl?: typeof fetch;
  checksumTextFetcher?: ChecksumTextFetcher;
  spawn?: AppUpdateSpawnLike;
  now?: () => string;
  baseEnv?: NodeJS.ProcessEnv;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  digest?: string;
}

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
}

const DEFAULT_REPO_FULL_NAME = "rocky-projcet/rocky";
const DEFAULT_CURRENT_VERSION = "0.0.0";
const CHECKSUM_ASSET_PATTERN =
  /(?:^|[-_])(sha256sums?|checksums?)(?:[-_.].*)?\.txt$|\.sha256(?:sum)?$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

export class AppUpdateService implements AppUpdateServiceLike {
  private readonly stateRoot: string;
  private readonly fetchImpl: typeof fetch;
  private readonly checksumTextFetcher?: ChecksumTextFetcher;
  private readonly spawn: AppUpdateSpawnLike;
  private readonly now: () => string;
  private readonly platform: NodeJS.Platform;
  private readonly currentVersion: string;
  private readonly repoFullName: string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private checksumAssetDownloadUrl: string | null = null;
  private state: AppUpdateRecord;

  constructor(options: AppUpdateServiceOptions = {}) {
    this.stateRoot = options.stateRoot ?? process.cwd();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.checksumTextFetcher = options.checksumTextFetcher;
    this.spawn = options.spawn ?? (defaultSpawn as unknown as AppUpdateSpawnLike);
    this.now = options.now ?? (() => new Date().toISOString());
    this.platform = options.platform ?? process.platform;
    this.currentVersion = normalizeVersion(
      options.currentVersion ??
        process.env.ROCKY_APP_VERSION ??
        process.env.npm_package_version ??
        DEFAULT_CURRENT_VERSION
    );
    this.repoFullName = options.repoFullName ?? DEFAULT_REPO_FULL_NAME;
    this.baseEnv = options.baseEnv ?? process.env;
    this.state = this.initialState();
  }

  getState(): AppUpdateRecord {
    return this.state;
  }

  async checkForUpdates(): Promise<AppUpdateRecord> {
    if (!this.isSupported()) {
      return this.setState({
        status: "unsupported",
        checkedAt: this.now(),
        lastError: "Windows installer updates are only supported on Windows.",
      });
    }

    this.setState({
      status: "checking",
      checkedAt: null,
      completedAt: null,
      lastError: null,
    });

    try {
      const release = await this.fetchLatestRelease();
      const latestVersion = normalizeVersion(
        release.tag_name ?? release.name ?? ""
      );
      if (!latestVersion) {
        return this.fail("Latest GitHub Release does not include a version tag.");
      }

      const updateAvailable =
        compareVersions(latestVersion, this.currentVersion) > 0;
      if (!updateAvailable) {
        this.checksumAssetDownloadUrl = null;
        return this.setState({
          status: "current",
          latestVersion,
          releaseUrl: readNonEmptyString(release.html_url),
          updateAvailable: false,
          installerAsset: null,
          download: null,
          checkedAt: this.now(),
          completedAt: this.now(),
          lastError: null,
        });
      }

      const assets = Array.isArray(release.assets) ? release.assets : [];
      const installerAsset = selectWindowsInstallerAsset(assets);
      if (!installerAsset) {
        this.checksumAssetDownloadUrl = null;
        return this.fail("Latest GitHub Release does not include a Windows installer asset.");
      }

      const checksumAsset = selectChecksumAsset(assets, installerAsset.name);
      const digest = parseSha256Digest(installerAsset.digest);
      this.checksumAssetDownloadUrl = checksumAsset?.browser_download_url ?? null;

      return this.setState({
        status: "update-available",
        latestVersion,
        releaseUrl: readNonEmptyString(release.html_url),
        updateAvailable: true,
        installerAsset: {
          name: installerAsset.name,
          downloadUrl: installerAsset.browser_download_url,
          size: Number.isFinite(installerAsset.size)
            ? Number(installerAsset.size)
            : null,
          sha256: digest,
          checksumSource: digest ? "github-asset-digest" : null,
          checksumAssetName: checksumAsset?.name ?? null,
        },
        download: null,
        checkedAt: this.now(),
        completedAt: this.now(),
        lastError: null,
      });
    } catch (error) {
      return this.fail(error);
    }
  }

  async downloadInstaller(): Promise<AppUpdateRecord> {
    if (!this.isSupported()) {
      return this.fail("Windows installer updates are only supported on Windows.");
    }

    try {
      let state = this.state;
      if (!state.updateAvailable || !state.installerAsset) {
        state = await this.checkForUpdates();
      }
      const asset = state.installerAsset;
      if (!asset || !state.updateAvailable) {
        return this.fail("No Rocky update installer is available to download.");
      }

      const expectedSha256 = await this.resolveExpectedSha256(asset);
      if (!expectedSha256) {
        return this.fail("Installer checksum is unavailable; download cannot be trusted.");
      }

      const response = await this.fetchImpl(asset.downloadUrl);
      if (!response.ok) {
        return this.fail(
          `Installer download failed with HTTP ${response.status}.`
        );
      }

      const body = Buffer.from(await response.arrayBuffer());
      const actualSha256 = createHash("sha256").update(body).digest("hex");
      if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
        return this.fail(
          `Installer checksum mismatch. Expected ${expectedSha256}, got ${actualSha256}.`
        );
      }

      const downloadsDir = path.join(this.stateRoot, ".runtime", "app-updates");
      await mkdir(downloadsDir, { recursive: true });
      const installerPath = path.join(downloadsDir, path.basename(asset.name));
      await writeFile(installerPath, body);
      const timestamp = this.now();

      return this.setState({
        status: "downloaded",
        download: {
          path: installerPath,
          fileName: asset.name,
          size: body.byteLength,
          sha256: actualSha256,
          verified: true,
          downloadedAt: timestamp,
          verifiedAt: timestamp,
        },
        startedAt: null,
        completedAt: timestamp,
        lastError: null,
      });
    } catch (error) {
      return this.fail(error);
    }
  }

  async startInstaller(input: {
    confirmedRestartRisk: boolean;
  }): Promise<AppUpdateRecord> {
    if (!input.confirmedRestartRisk) {
      return this.fail("You must confirm the restart risk before running the installer.");
    }
    if (!this.isSupported()) {
      return this.fail("Windows installer updates are only supported on Windows.");
    }

    const download = this.state.download;
    if (!download?.verified) {
      return this.fail("A verified Rocky installer download is required before install.");
    }

    try {
      const startedAt = this.now();
      this.setState({
        status: "installing",
        startedAt,
        completedAt: null,
        lastError: null,
      });
      const child = this.spawn(download.path, [], {
        cwd: path.dirname(download.path),
        env: this.baseEnv,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      child.unref?.();

      return this.setState({
        status: "install-started",
        startedAt,
        completedAt: this.now(),
        lastError: null,
      });
    } catch (error) {
      return this.fail(error);
    }
  }

  private initialState(): AppUpdateRecord {
    const supported = this.isSupported();
    return {
      currentVersion: this.currentVersion,
      platform: this.platform,
      supported,
      status: supported ? "idle" : "unsupported",
      latestVersion: null,
      releaseUrl: null,
      updateAvailable: false,
      installerAsset: null,
      download: null,
      preservedPathNames: [...preservedInstallPathNames],
      checkedAt: null,
      startedAt: null,
      completedAt: null,
      lastError: supported
        ? null
        : "Windows installer updates are only supported on Windows.",
    };
  }

  private isSupported(): boolean {
    return this.platform === "win32";
  }

  private async fetchLatestRelease(): Promise<GitHubReleasePayload> {
    const response = await this.fetchImpl(
      `https://api.github.com/repos/${this.repoFullName}/releases/latest`
    );
    if (!response.ok) {
      throw new Error(`GitHub Release check failed with HTTP ${response.status}.`);
    }

    const parsed = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("GitHub Release response was not a JSON object.");
    }

    return parsed as GitHubReleasePayload;
  }

  private async resolveExpectedSha256(
    asset: AppUpdateAssetRecord
  ): Promise<string | null> {
    if (asset.sha256) {
      return asset.sha256;
    }
    if (!this.checksumAssetDownloadUrl) {
      return null;
    }

    const text = this.checksumTextFetcher
      ? await this.checksumTextFetcher(this.checksumAssetDownloadUrl)
      : await this.fetchChecksumText(this.checksumAssetDownloadUrl);
    const checksum = parseChecksumText(text, asset.name);
    if (!checksum) {
      return null;
    }

    this.setState({
      installerAsset: {
        ...asset,
        sha256: checksum,
        checksumSource: "checksum-asset",
      },
    });
    return checksum;
  }

  private async fetchChecksumText(url: string): Promise<string> {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Checksum download failed with HTTP ${response.status}.`);
    }
    return response.text();
  }

  private setState(patch: Partial<AppUpdateRecord>): AppUpdateRecord {
    this.state = {
      ...this.state,
      ...patch,
      preservedPathNames: [...preservedInstallPathNames],
    };
    return this.state;
  }

  private fail(error: unknown): AppUpdateRecord {
    const message = error instanceof Error ? error.message : String(error);
    return this.setState({
      status: "failed",
      completedAt: this.now(),
      lastError: message,
    });
  }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/iu, "");
}

function comparableParts(version: string): number[] {
  const normalized = normalizeVersion(version).split(/[+-]/u)[0] ?? "";
  return normalized
    .split(".")
    .map((part) => Number.parseInt(part.replace(/\D.*/u, ""), 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left: string, right: string): number {
  const leftParts = comparableParts(left);
  const rightParts = comparableParts(right);
  const length = Math.max(leftParts.length, rightParts.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function selectWindowsInstallerAsset(
  assets: GitHubReleaseAsset[]
): GitHubReleaseAsset | null {
  const candidates = assets.filter((asset) => {
    const name = asset.name ?? "";
    return (
      /\.exe$/iu.test(name) &&
      (/^Rocky-Setup-v?.+\.exe$/iu.test(name) ||
        /rocky.*(?:setup|installer).*\.exe$/iu.test(name) ||
        /windows.*(?:setup|installer).*\.exe$/iu.test(name))
    );
  });

  return candidates[0] ?? null;
}

function selectChecksumAsset(
  assets: GitHubReleaseAsset[],
  installerName: string
): GitHubReleaseAsset | null {
  const exactNames = new Set([
    `${installerName}.sha256`,
    `${installerName}.sha256sum`,
    `${installerName}.sha256.txt`,
    "SHA256SUMS.txt",
    "SHA256SUMS",
  ]);
  return (
    assets.find((asset) => exactNames.has(asset.name)) ??
    assets.find((asset) => CHECKSUM_ASSET_PATTERN.test(asset.name)) ??
    null
  );
}

function parseSha256Digest(
  digest: string | null | undefined
): string | null {
  const value = readNonEmptyString(digest);
  if (!value) {
    return null;
  }
  const match = value.match(/^sha256:([a-f0-9]{64})$/iu);
  return match?.[1]?.toLowerCase() ?? null;
}

function parseChecksumText(text: string, installerName: string): string | null {
  const trimmed = text.trim();
  if (SHA256_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const normalizedInstallerName = installerName.toLowerCase();
  for (const line of text.split(/\r?\n/u)) {
    const parts = line.trim().split(/\s+/u);
    const hash = parts.find((part) => SHA256_PATTERN.test(part));
    if (!hash) {
      continue;
    }
    const mentionsInstaller = parts
      .slice(1)
      .some((part) =>
        part.replace(/^\*/u, "").toLowerCase().endsWith(normalizedInstallerName)
      );
    if (mentionsInstaller) {
      return hash.toLowerCase();
    }
  }

  return null;
}
