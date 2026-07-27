import { spawn as defaultSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  preservedInstallPathNames,
} from "./update-safety.js";

import type {
  AppUpdateAssetKind,
  AppUpdateAssetRecord,
  AppUpdateChecksumSource,
  AppUpdateDownloadProgress,
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
  arch?: string;
  repoFullName?: string;
  githubToken?: string;
  fetchImpl?: typeof fetch;
  checksumTextFetcher?: ChecksumTextFetcher;
  spawn?: AppUpdateSpawnLike;
  now?: () => string;
  baseEnv?: NodeJS.ProcessEnv;
}

interface GitHubReleaseAsset {
  name: string;
  url?: string;
  browser_download_url: string;
  size?: number;
  digest?: string;
}

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
}

interface SelectedInstallerAsset {
  asset: GitHubReleaseAsset;
  kind: AppUpdateAssetKind;
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
  private readonly architecture: string;
  private readonly currentVersion: string;
  private readonly repoFullName: string;
  private readonly githubToken: string | null;
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
    this.architecture = options.arch ?? process.arch;
    this.currentVersion = normalizeVersion(
      options.currentVersion ??
        process.env.ROCKY_APP_VERSION ??
        process.env.npm_package_version ??
        DEFAULT_CURRENT_VERSION
    );
    this.repoFullName = options.repoFullName ?? DEFAULT_REPO_FULL_NAME;
    this.githubToken = readNonEmptyString(
      options.githubToken ??
        process.env.ROCKY_GITHUB_TOKEN ??
        process.env.GITHUB_TOKEN ??
        process.env.GITHUB_PAT ??
        process.env.GH_TOKEN
    );
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
        lastError: this.unsupportedMessage(),
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
          releaseNotes: readNonEmptyString(release.body),
          updateAvailable: false,
          installerAsset: null,
          download: null,
          downloadProgress: null,
          checkedAt: this.now(),
          completedAt: this.now(),
          lastError: null,
        });
      }

      const assets = Array.isArray(release.assets) ? release.assets : [];
      const selection = selectInstallerAsset(
        this.platform,
        assets,
        this.architecture
      );
      if (!selection) {
        this.checksumAssetDownloadUrl = null;
        return this.fail(
          this.platform === "darwin"
            ? "Latest GitHub Release does not include a macOS .pkg, .dmg, or .app.zip asset."
            : "Latest GitHub Release does not include a Windows installer asset."
        );
      }
      const { asset: installerAsset, kind } = selection;

      const checksumAsset = selectChecksumAsset(assets, installerAsset.name);
      const digest = parseSha256Digest(installerAsset.digest);
      this.checksumAssetDownloadUrl = checksumAsset
        ? resolveReleaseAssetUrl(checksumAsset)
        : null;

      return this.setState({
        status: "update-available",
        latestVersion,
        releaseUrl: readNonEmptyString(release.html_url),
        releaseNotes: readNonEmptyString(release.body),
        updateAvailable: true,
        installerAsset: {
          kind,
          name: installerAsset.name,
          downloadUrl: resolveReleaseAssetUrl(installerAsset),
          size: Number.isFinite(installerAsset.size)
            ? Number(installerAsset.size)
            : null,
          sha256: digest,
          checksumSource: digest ? "github-asset-digest" : null,
          checksumAssetName: checksumAsset?.name ?? null,
        },
        download: null,
        downloadProgress: null,
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
      return this.fail(this.unsupportedMessage());
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

      const response = await this.fetchImpl(
        asset.downloadUrl,
        this.githubRequestInit("application/octet-stream")
      );
      if (!response.ok) {
        return this.fail(
          `Installer download failed with HTTP ${response.status}.`
        );
      }

      const body = await this.readDownloadBody(response, asset.size);
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
        downloadProgress: {
          bytesReceived: body.byteLength,
          totalBytes: body.byteLength,
          percent: 100,
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
      return this.fail(this.unsupportedMessage());
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
      const command =
        this.platform === "darwin" ? "/usr/bin/open" : download.path;
      const args = this.platform === "darwin" ? [download.path] : [];
      const child = this.spawn(command, args, {
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

  async revealDownload(): Promise<AppUpdateRecord> {
    if (!this.isSupported()) {
      return this.fail(this.unsupportedMessage());
    }

    const download = this.state.download;
    if (!download?.verified) {
      return this.fail(
        "A verified Rocky installer download is required before opening its location."
      );
    }

    try {
      const command =
        this.platform === "darwin" ? "/usr/bin/open" : "explorer.exe";
      const args =
        this.platform === "darwin"
          ? ["-R", download.path]
          : [`/select,${download.path}`];
      const child = this.spawn(command, args, {
        cwd: path.dirname(download.path),
        env: this.baseEnv,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
      });
      child.unref?.();

      return this.setState({
        status: "downloaded",
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
      releaseNotes: null,
      limitations: buildPlatformLimitations(this.platform),
      updateAvailable: false,
      installerAsset: null,
      download: null,
      downloadProgress: null,
      preservedPathNames: [...preservedInstallPathNames],
      checkedAt: null,
      startedAt: null,
      completedAt: null,
      lastError: supported ? null : this.unsupportedMessage(),
    };
  }

  private isSupported(): boolean {
    return this.platform === "win32" || this.platform === "darwin";
  }

  private unsupportedMessage(): string {
    return "Rocky installer updates are only supported on Windows and macOS.";
  }

  private async fetchLatestRelease(): Promise<GitHubReleasePayload> {
    const response = await this.fetchImpl(
      `https://api.github.com/repos/${this.repoFullName}/releases/latest`,
      this.githubRequestInit("application/vnd.github+json")
    );
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          "No accessible GitHub Release was found. Private repositories require a GitHub token."
        );
      }
      throw new Error(`GitHub Release check failed with HTTP ${response.status}.`);
    }

    const parsed = await response.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("GitHub Release response was not a JSON object.");
    }

    return parsed as GitHubReleasePayload;
  }

  private async readDownloadBody(
    response: Response,
    assetSize: number | null
  ): Promise<Buffer> {
    const contentLength = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10
    );
    const totalBytes = Number.isFinite(contentLength) && contentLength >= 0
      ? contentLength
      : assetSize;
    const chunks: Buffer[] = [];
    let bytesReceived = 0;

    this.setState({
      status: "downloading",
      downloadProgress: createDownloadProgress(bytesReceived, totalBytes),
      completedAt: null,
      lastError: null,
    });

    if (!response.body) {
      const body = Buffer.from(await response.arrayBuffer());
      this.setState({
        downloadProgress: createDownloadProgress(body.byteLength, totalBytes),
      });
      return body;
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      bytesReceived += chunk.byteLength;
      this.setState({
        downloadProgress: createDownloadProgress(bytesReceived, totalBytes),
      });
    }

    return Buffer.concat(chunks, bytesReceived);
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
    const response = await this.fetchImpl(
      url,
      this.githubRequestInit("text/plain")
    );
    if (!response.ok) {
      throw new Error(`Checksum download failed with HTTP ${response.status}.`);
    }
    return response.text();
  }

  private githubRequestInit(accept: string): RequestInit {
    return {
      headers: {
        Accept: accept,
        ...(this.githubToken
          ? { Authorization: `Bearer ${this.githubToken}` }
          : {}),
      },
    };
  }

  private setState(patch: Partial<AppUpdateRecord>): AppUpdateRecord {
    this.state = {
      ...this.state,
      ...patch,
      preservedPathNames: [...preservedInstallPathNames],
      limitations: buildPlatformLimitations(this.platform),
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

function resolveReleaseAssetUrl(asset: GitHubReleaseAsset): string {
  return readNonEmptyString(asset.url) ?? asset.browser_download_url;
}

function selectInstallerAsset(
  platform: NodeJS.Platform,
  assets: GitHubReleaseAsset[],
  architecture: string = process.arch
): SelectedInstallerAsset | null {
  if (platform === "win32") {
    const asset = selectWindowsInstallerAsset(assets);
    return asset ? { asset, kind: "windows-exe" } : null;
  }

  if (platform !== "darwin") {
    return null;
  }

  const macCandidates: Array<{
    kind: AppUpdateAssetKind;
    pattern: RegExp;
  }> = [
    { kind: "macos-pkg", pattern: /\.pkg$/iu },
    { kind: "macos-dmg", pattern: /\.dmg$/iu },
    { kind: "macos-app-zip", pattern: /\.app\.zip$/iu },
  ];
  for (const candidate of macCandidates) {
    const asset = assets
      .map((item) => ({
        item,
        architectureScore: macAssetArchitectureScore(
          item.name ?? "",
          architecture
        ),
      }))
      .filter(
        ({ item, architectureScore }) =>
          architectureScore > 0 &&
          /rocky/iu.test(item.name ?? "") &&
          candidate.pattern.test(item.name ?? "")
      )
      .sort(
        (left, right) =>
          right.architectureScore - left.architectureScore ||
          left.item.name.localeCompare(right.item.name)
      )[0]?.item;
    if (asset) {
      return {
        asset,
        kind: candidate.kind,
      };
    }
  }

  return null;
}

function macAssetArchitectureScore(
  assetName: string,
  architecture: string
): number {
  const lowerName = assetName.toLowerCase();
  const architectureAliases =
    architecture === "arm64"
      ? ["arm64", "aarch64"]
      : architecture === "x64"
        ? ["x64", "x86_64", "amd64"]
        : [architecture.toLowerCase()];
  if (architectureAliases.some((alias) => lowerName.includes(alias))) {
    return 2;
  }
  if (
    lowerName.includes("universal") ||
    !/(?:arm64|aarch64|x64|x86_64|amd64)/u.test(lowerName)
  ) {
    return 1;
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

function createDownloadProgress(
  bytesReceived: number,
  totalBytes: number | null
): AppUpdateDownloadProgress {
  const percent =
    totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((bytesReceived / totalBytes) * 100))
      : null;
  return {
    bytesReceived,
    totalBytes,
    percent,
  };
}

function buildPlatformLimitations(platform: NodeJS.Platform): string[] {
  if (platform !== "darwin") {
    return [];
  }

  return [
    "서명 또는 공증되지 않은 빌드는 Gatekeeper 경고가 표시될 수 있어요.",
    "일부 개발용 배포에서는 Node.js가 필요할 수 있어요.",
    "설치 후에도 Rocky의 사용자 설정과 runtime 데이터는 유지돼요.",
  ];
}
