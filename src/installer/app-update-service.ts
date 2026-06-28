import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  openFile as defaultOpenFile,
  openFolder as defaultOpenFolder,
  type NativeFileOpener,
  type NativeFolderOpener,
} from "../api/http/native-open.js";
import type {
  RockyAppUpdateAssetKind,
  RockyAppUpdateAssetRecord,
  RockyAppUpdateChecksumSource,
  RockyAppUpdateDownloadRecord,
  RockyAppUpdateOperationKind,
  RockyAppUpdateRecord,
  RockyAppUpdateServiceLike,
} from "./app-update-types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface GitHubReleaseAsset {
  name: string;
  size: number | null;
  browser_download_url: string;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string | null;
  assets: GitHubReleaseAsset[];
}

export interface RockyAppUpdateServiceOptions {
  stateRoot?: string;
  githubRepo?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  currentVersion?: string;
  fetchImpl?: FetchLike;
  openInstallerFile?: NativeFileOpener;
  openDownloadDirectory?: NativeFolderOpener;
  now?: () => string;
  downloadRoot?: string;
  githubToken?: string | null;
}

interface SelectedChecksum {
  checksumSha256: string | null;
  checksumSource: RockyAppUpdateChecksumSource | null;
}

const DEFAULT_GITHUB_REPO = "rocky-projcet/rocky";
const DEFAULT_STATE_ROOT = path.join(process.cwd(), ".runtime", "agent-engine");

function nowIso(): string {
  return new Date().toISOString();
}

function cloneState(state: RockyAppUpdateRecord): RockyAppUpdateRecord {
  return structuredClone(state);
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/u, "");
}

function parseVersion(value: string): {
  numbers: number[];
  prerelease: string | null;
} {
  const [main = "", prerelease = null] = normalizeVersion(value).split("-", 2);
  const numbers = main.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });

  while (numbers.length < 3) {
    numbers.push(0);
  }

  return {
    numbers,
    prerelease,
  };
}

function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    const diff = parsedLeft.numbers[index] - parsedRight.numbers[index];
    if (diff !== 0) {
      return diff;
    }
  }

  if (parsedLeft.prerelease === parsedRight.prerelease) {
    return 0;
  }
  if (!parsedLeft.prerelease) {
    return 1;
  }
  if (!parsedRight.prerelease) {
    return -1;
  }
  return parsedLeft.prerelease.localeCompare(parsedRight.prerelease);
}

function resolveCurrentVersion(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ROCKY_APP_PACKAGE_JSON,
    path.join(process.cwd(), "package.json"),
    path.join(moduleDir, "../../../package.json"),
    path.join(moduleDir, "../../package.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) {
        continue;
      }
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: unknown;
      };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return normalizeVersion(parsed.version);
      }
    } catch {
      // Try the next package metadata location.
    }
  }

  return "0.0.0";
}

function resolveStateRoot(stateRoot?: string): string {
  return path.resolve(stateRoot ?? DEFAULT_STATE_ROOT);
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveGithubToken(option: string | null | undefined): string | null {
  if (option !== undefined) {
    return normalizeOptionalString(option);
  }
  return (
    normalizeOptionalString(process.env.GITHUB_TOKEN) ??
    normalizeOptionalString(process.env.GITHUB_PAT) ??
    normalizeOptionalString(process.env.GH_TOKEN)
  );
}

function assetKind(name: string): RockyAppUpdateAssetKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pkg")) {
    return "pkg";
  }
  if (lower.endsWith(".dmg")) {
    return "dmg";
  }
  if (lower.endsWith(".app.zip")) {
    return "app-zip";
  }
  return null;
}

function archAliases(arch: string): string[] {
  if (arch === "x64") {
    return ["x64", "x86_64", "amd64"];
  }
  return [arch];
}

function hasSpecificArch(name: string): boolean {
  return /(?:arm64|aarch64|x64|x86_64|amd64)/iu.test(name);
}

function assetArchScore(assetName: string, arch: string): number {
  const lower = assetName.toLowerCase();
  if (archAliases(arch).some((alias) => lower.includes(alias))) {
    return 2;
  }
  if (lower.includes("universal") || !hasSpecificArch(lower)) {
    return 1;
  }
  return 0;
}

function isMacReleaseAsset(assetName: string): boolean {
  const lower = assetName.toLowerCase();
  if (lower.includes("windows") || lower.includes("win32")) {
    return false;
  }
  return lower.includes("macos") || lower.includes("darwin") || lower.includes("osx");
}

function selectMacAsset(
  release: GitHubRelease,
  arch: string
): GitHubReleaseAsset | null {
  const kindPriority = new Map<RockyAppUpdateAssetKind, number>([
    ["pkg", 0],
    ["dmg", 1],
    ["app-zip", 2],
  ]);

  const candidates = release.assets
    .map((asset) => ({ asset, kind: assetKind(asset.name) }))
    .filter(
      (entry): entry is { asset: GitHubReleaseAsset; kind: RockyAppUpdateAssetKind } =>
        Boolean(entry.kind) && isMacReleaseAsset(entry.asset.name)
    )
    .map((entry) => ({
      ...entry,
      archScore: assetArchScore(entry.asset.name, arch),
    }))
    .filter((entry) => entry.archScore > 0)
    .sort((left, right) => {
      const kindDiff = kindPriority.get(left.kind)! - kindPriority.get(right.kind)!;
      if (kindDiff !== 0) {
        return kindDiff;
      }

      return right.archScore - left.archScore || left.asset.name.localeCompare(right.asset.name);
    });

  return candidates[0]?.asset ?? null;
}

function digestChecksum(asset: GitHubReleaseAsset): SelectedChecksum {
  const digest = asset.digest;
  if (typeof digest !== "string") {
    return {
      checksumSha256: null,
      checksumSource: null,
    };
  }

  const match = /^sha256:([a-f0-9]{64})$/iu.exec(digest.trim());
  if (!match) {
    return {
      checksumSha256: null,
      checksumSource: null,
    };
  }

  return {
    checksumSha256: match[1].toLowerCase(),
    checksumSource: "github-asset-digest",
  };
}

function selectChecksumManifest(
  release: GitHubRelease,
  arch: string
): GitHubReleaseAsset | null {
  const aliases = archAliases(arch);
  const candidates = release.assets
    .filter((asset) => {
      const lower = asset.name.toLowerCase();
      return (
        (lower.includes("sha256") || lower.includes("shasum")) &&
        lower.endsWith(".txt")
      );
    })
    .sort((left, right) => {
      const leftLower = left.name.toLowerCase();
      const rightLower = right.name.toLowerCase();
      const leftScore =
        (leftLower.includes("macos") ? 4 : 0) +
        (aliases.some((alias) => leftLower.includes(alias)) ? 2 : 0);
      const rightScore =
        (rightLower.includes("macos") ? 4 : 0) +
        (aliases.some((alias) => rightLower.includes(alias)) ? 2 : 0);
      return rightScore - leftScore || left.name.localeCompare(right.name);
    });

  return candidates[0] ?? null;
}

function parseChecksumManifest(
  manifestText: string,
  assetName: string
): string | null {
  for (const line of manifestText.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([a-f0-9]{64})\s+[* ]?(.+)$/iu.exec(trimmed);
    if (!match) {
      continue;
    }

    const filename = path.basename(match[2].trim());
    if (filename === assetName) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

function normalizeRelease(payload: unknown): GitHubRelease {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("GitHub Release 응답 형식이 올바르지 않습니다.");
  }

  const record = payload as Record<string, unknown>;
  const tagName = record.tag_name;
  const assets = record.assets;
  if (typeof tagName !== "string" || !Array.isArray(assets)) {
    throw new Error("GitHub Release 응답에 tag_name 또는 assets가 없습니다.");
  }

  return {
    tag_name: tagName,
    html_url: typeof record.html_url === "string" ? record.html_url : null,
    assets: assets.flatMap((asset): GitHubReleaseAsset[] => {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
        return [];
      }
      const assetRecord = asset as Record<string, unknown>;
      if (
        typeof assetRecord.name !== "string" ||
        typeof assetRecord.browser_download_url !== "string"
      ) {
        return [];
      }
      return [
        {
          name: assetRecord.name,
          browser_download_url: assetRecord.browser_download_url,
          size:
            typeof assetRecord.size === "number" && Number.isFinite(assetRecord.size)
              ? assetRecord.size
              : null,
          digest:
            typeof assetRecord.digest === "string"
              ? assetRecord.digest
              : null,
        },
      ];
    }),
  };
}

function assertChildPath(parent: string, child: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`다운로드 경로가 상태 루트 밖을 가리킵니다: ${child}`);
  }
}

function releaseAssetRecord(
  asset: GitHubReleaseAsset,
  checksum: SelectedChecksum
): RockyAppUpdateAssetRecord {
  const kind = assetKind(asset.name);
  if (!kind) {
    throw new Error(`지원하지 않는 macOS asset 형식입니다: ${asset.name}`);
  }

  return {
    name: asset.name,
    kind,
    sizeBytes: asset.size,
    downloadUrl: asset.browser_download_url,
    checksumSha256: checksum.checksumSha256,
    checksumSource: checksum.checksumSource,
  };
}

function defaultLimitations(platform: NodeJS.Platform): string[] {
  if (platform !== "darwin") {
    return ["Rocky 앱 업데이트 실행은 현재 macOS 서비스 화면에서만 지원됩니다."];
  }

  return [
    "macOS 산출물은 unsigned/notarized 상태일 수 있어 Gatekeeper 경고가 나타날 수 있습니다.",
    "차단되면 System Settings > Privacy & Security에서 Open Anyway를 선택해야 할 수 있습니다.",
    "현재 배포는 Node.js 22+가 Mac 아키텍처에 맞게 설치되어 있다는 전제를 유지합니다.",
  ];
}

function defaultStatePreservation(): string[] {
  return [
    "/Applications/Rocky.app 교체는 기본 state root를 삭제하지 않습니다.",
    "~/Library/Application Support/Rocky/agent-engine 아래 세션, 작업, 런타임 상태는 앱 번들 밖에 남습니다.",
    "초기 수동 설치 payload의 .runtime, .codex, .tools, .env, .env.local, .rocky-env.ps1 경로는 보존 대상입니다.",
  ];
}

export class RockyAppUpdateService implements RockyAppUpdateServiceLike {
  private readonly stateRoot: string;
  private readonly githubRepo: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly fetchImpl: FetchLike;
  private readonly openInstallerFile: NativeFileOpener;
  private readonly openDownloadDirectory: NativeFolderOpener;
  private readonly now: () => string;
  private readonly githubToken: string | null;
  private readonly downloadRoot: string;
  private state: RockyAppUpdateRecord;

  constructor(options: RockyAppUpdateServiceOptions = {}) {
    this.stateRoot = resolveStateRoot(options.stateRoot);
    this.githubRepo = options.githubRepo ?? DEFAULT_GITHUB_REPO;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? os.arch();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.openInstallerFile = options.openInstallerFile ?? defaultOpenFile;
    this.openDownloadDirectory = options.openDownloadDirectory ?? defaultOpenFolder;
    this.now = options.now ?? nowIso;
    this.githubToken = resolveGithubToken(options.githubToken);
    this.downloadRoot =
      options.downloadRoot ?? path.join(this.stateRoot, "app-updates");
    this.state = this.createInitialState(
      normalizeVersion(options.currentVersion ?? resolveCurrentVersion())
    );
  }

  async getState(): Promise<RockyAppUpdateRecord> {
    return cloneState(this.state);
  }

  async checkForUpdate(): Promise<RockyAppUpdateRecord> {
    this.beginOperation("check");
    if (!this.state.supported) {
      this.completeOperation("Rocky 앱 업데이트는 현재 macOS에서만 실행할 수 있습니다.");
      return cloneState(this.state);
    }

    try {
      const release = await this.fetchLatestRelease();
      const latestVersion = normalizeVersion(release.tag_name);
      const checkedAt = this.now();
      const releaseUrl = release.html_url;

      if (compareVersions(latestVersion, this.state.currentVersion) <= 0) {
        this.state = {
          ...this.state,
          latestVersion,
          latestStatus: "current",
          checkedAt,
          releaseUrl,
          statusText: "현재 설치된 Rocky가 최신 버전입니다.",
          asset: null,
          download: null,
        };
        this.completeOperation();
        return cloneState(this.state);
      }

      const selectedAsset = selectMacAsset(release, this.arch);
      if (!selectedAsset) {
        this.state = {
          ...this.state,
          latestVersion,
          latestStatus: "update-available",
          checkedAt,
          releaseUrl,
          statusText:
            "새 Rocky Release는 있지만 이 Mac에 맞는 .pkg, .dmg, .app.zip asset을 찾지 못했습니다.",
          asset: null,
          download: null,
        };
        this.failOperation("macOS 업데이트 asset을 찾지 못했습니다.");
        return cloneState(this.state);
      }

      const checksum = await this.resolveChecksum(release, selectedAsset);
      const asset = releaseAssetRecord(selectedAsset, checksum);
      this.state = {
        ...this.state,
        latestVersion,
        latestStatus: "update-available",
        checkedAt,
        releaseUrl,
        statusText: asset.checksumSha256
          ? "새 Rocky macOS 업데이트를 다운로드할 수 있습니다."
          : "새 Rocky macOS 업데이트를 찾았지만 checksum 정보가 없어 설치로 이어갈 수 없습니다.",
        asset,
        download: null,
      };

      if (!asset.checksumSha256) {
        this.failOperation("선택한 macOS asset의 checksum 정보를 찾지 못했습니다.");
      } else {
        this.completeOperation();
      }
    } catch (error) {
      this.state = {
        ...this.state,
        latestStatus: "error",
        statusText: "GitHub Release 업데이트 확인에 실패했습니다.",
      };
      this.failOperation(error);
    }

    return cloneState(this.state);
  }

  async downloadUpdate(): Promise<RockyAppUpdateRecord> {
    this.beginOperation("download");
    if (!this.state.supported) {
      this.failOperation("Rocky 앱 업데이트는 현재 macOS에서만 실행할 수 있습니다.");
      return cloneState(this.state);
    }

    try {
      if (!this.state.asset || this.state.latestStatus !== "update-available") {
        await this.checkForUpdate();
        this.beginOperation("download");
      }

      const asset = this.state.asset;
      if (!asset) {
        throw new Error("다운로드할 macOS 업데이트 asset이 없습니다.");
      }
      if (!asset.checksumSha256) {
        throw new Error("checksum 정보가 없어 업데이트 asset을 검증할 수 없습니다.");
      }

      await mkdir(this.downloadRoot, { recursive: true });
      const fileName = path.basename(asset.name);
      const filePath = path.join(this.downloadRoot, fileName);
      assertChildPath(this.downloadRoot, filePath);

      const response = await this.fetchAsset(asset.downloadUrl);
      const download = await this.writeVerifiedDownload(response, filePath, asset);
      this.state = {
        ...this.state,
        download,
        statusText:
          asset.kind === "pkg"
            ? "업데이트 asset 검증이 끝났습니다. macOS Installer로 열 수 있습니다."
            : "업데이트 asset 검증이 끝났습니다. 다운로드 위치에서 수동 설치를 진행할 수 있습니다.",
      };
      this.completeOperation();
    } catch (error) {
      this.failOperation(error);
    }

    return cloneState(this.state);
  }

  async openInstaller(): Promise<RockyAppUpdateRecord> {
    this.beginOperation("install");
    if (!this.state.supported) {
      this.failOperation("Rocky 앱 업데이트는 현재 macOS에서만 실행할 수 있습니다.");
      return cloneState(this.state);
    }

    try {
      const asset = this.state.asset;
      const download = this.state.download;
      if (!asset || !download?.verified) {
        throw new Error("검증된 업데이트 다운로드가 없습니다.");
      }

      if (asset.kind === "app-zip") {
        const opened = await this.openDownloadDirectory(download.directory);
        this.state = {
          ...this.state,
          statusText:
            ".app.zip은 자동 설치하지 않습니다. Finder에서 압축을 풀고 Rocky.app을 /Applications로 옮기세요.",
          install: {
            status: "manual-action",
            openedAt: this.now(),
            message:
              "Finder에서 다운로드 위치를 열었습니다. 압축 해제 후 Rocky.app을 /Applications로 옮기세요.",
            nativeOpen: opened,
          },
        };
        this.completeOperation();
        return cloneState(this.state);
      }

      const opened = await this.openInstallerFile(download.filePath);
      this.state = {
        ...this.state,
        statusText:
          asset.kind === "pkg"
            ? "macOS Installer를 열었습니다. 설치 흐름을 완료하면 /Applications/Rocky.app이 교체됩니다."
            : "DMG를 열었습니다. Finder에서 Rocky.app을 /Applications로 옮기세요.",
        install: {
          status: asset.kind === "pkg" ? "opened" : "manual-action",
          openedAt: this.now(),
          message:
            asset.kind === "pkg"
              ? "macOS Installer 흐름을 완료하세요."
              : "DMG 안의 Rocky.app을 /Applications로 옮기세요.",
          nativeOpen: opened,
        },
      };
      this.completeOperation();
    } catch (error) {
      this.state = {
        ...this.state,
        install: {
          ...this.state.install,
          status: "failed",
          message:
            "설치 파일을 열지 못했습니다. 다운로드 위치를 열어 수동 설치를 진행하세요.",
        },
      };
      this.failOperation(error);
    }

    return cloneState(this.state);
  }

  async openDownloadFolder(): Promise<RockyAppUpdateRecord> {
    this.beginOperation("open-folder");
    try {
      const folderPath = this.state.download?.directory ?? this.downloadRoot;
      await mkdir(folderPath, { recursive: true });
      const opened = await this.openDownloadDirectory(folderPath);
      this.state = {
        ...this.state,
        install: {
          ...this.state.install,
          status: "manual-action",
          openedAt: this.now(),
          message: "다운로드 위치를 열었습니다.",
          nativeOpen: opened,
        },
      };
      this.completeOperation();
    } catch (error) {
      this.failOperation(error);
    }

    return cloneState(this.state);
  }

  private createInitialState(currentVersion: string): RockyAppUpdateRecord {
    const supported = this.platform === "darwin";
    return {
      appName: "Rocky",
      platform: this.platform,
      arch: this.arch,
      supported,
      currentVersion,
      latestVersion: null,
      latestStatus: "unknown",
      checkedAt: null,
      releaseUrl: null,
      statusText: supported
        ? "Rocky 앱 업데이트 상태를 아직 확인하지 않았습니다."
        : "Rocky 앱 업데이트는 현재 macOS에서만 지원됩니다.",
      asset: null,
      download: null,
      operation: {
        kind: null,
        status: "idle",
        startedAt: null,
        completedAt: null,
        lastError: null,
      },
      install: {
        status: "idle",
        openedAt: null,
        message: null,
        nativeOpen: null,
      },
      limitations: defaultLimitations(this.platform),
      statePreservation: defaultStatePreservation(),
    };
  }

  private beginOperation(kind: RockyAppUpdateOperationKind): void {
    this.state = {
      ...this.state,
      operation: {
        kind,
        status: "pending",
        startedAt: this.now(),
        completedAt: null,
        lastError: null,
      },
    };
  }

  private completeOperation(statusText?: string): void {
    this.state = {
      ...this.state,
      statusText: statusText ?? this.state.statusText,
      operation: {
        ...this.state.operation,
        status: "completed",
        completedAt: this.now(),
        lastError: null,
      },
    };
  }

  private failOperation(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.state = {
      ...this.state,
      statusText: message,
      operation: {
        ...this.state.operation,
        status: "failed",
        completedAt: this.now(),
        lastError: message,
      },
    };
  }

  private async fetchLatestRelease(): Promise<GitHubRelease> {
    const response = await this.fetchImpl(
      `https://api.github.com/repos/${this.githubRepo}/releases/latest`,
      {
        headers: this.githubHeaders("application/vnd.github+json"),
      }
    );
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          "GitHub 최신 Release를 찾지 못했습니다. 아직 Release가 없거나 private 저장소 접근 토큰이 필요합니다."
        );
      }
      throw new Error(
        `GitHub Release를 확인하지 못했습니다: ${response.status} ${response.statusText}`
      );
    }
    return normalizeRelease(await response.json());
  }

  private async fetchAsset(downloadUrl: string): Promise<Response> {
    const response = await this.fetchImpl(downloadUrl, {
      headers: this.githubHeaders("application/octet-stream"),
    });
    if (!response.ok) {
      throw new Error(
        `업데이트 asset 다운로드에 실패했습니다: ${response.status} ${response.statusText}`
      );
    }
    return response;
  }

  private githubHeaders(accept: string): HeadersInit {
    const headers: Record<string, string> = {
      accept,
      "user-agent": "rocky-app-updater",
    };
    if (this.githubToken) {
      headers.authorization = `Bearer ${this.githubToken}`;
    }
    return headers;
  }

  private async resolveChecksum(
    release: GitHubRelease,
    asset: GitHubReleaseAsset
  ): Promise<SelectedChecksum> {
    const digest = digestChecksum(asset);
    if (digest.checksumSha256) {
      return digest;
    }

    const manifest = selectChecksumManifest(release, this.arch);
    if (!manifest) {
      return {
        checksumSha256: null,
        checksumSource: null,
      };
    }

    const response = await this.fetchAsset(manifest.browser_download_url);
    const manifestText = await response.text();
    const checksum = parseChecksumManifest(manifestText, asset.name);
    return {
      checksumSha256: checksum,
      checksumSource: checksum ? "release-manifest" : null,
    };
  }

  private async writeVerifiedDownload(
    response: Response,
    filePath: string,
    asset: RockyAppUpdateAssetRecord
  ): Promise<RockyAppUpdateDownloadRecord> {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const handle = await open(filePath, "w");

    try {
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          const chunk = Buffer.from(value);
          hash.update(chunk);
          sizeBytes += chunk.length;
          await handle.write(chunk);
        }
      } else {
        const chunk = Buffer.from(await response.arrayBuffer());
        hash.update(chunk);
        sizeBytes += chunk.length;
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }

    const sha256 = hash.digest("hex");
    const expected = asset.checksumSha256;
    const verified = Boolean(expected && sha256 === expected.toLowerCase());
    if (!verified) {
      await rm(filePath, { force: true });
      throw new Error(
        `checksum 검증에 실패했습니다. expected=${expected ?? "unknown"} actual=${sha256}`
      );
    }

    return {
      fileName: path.basename(filePath),
      filePath,
      directory: path.dirname(filePath),
      sizeBytes,
      sha256,
      verified,
      verifiedAt: this.now(),
    };
  }
}

export const appUpdateServiceInternals = {
  compareVersions,
  parseChecksumManifest,
  selectMacAsset,
};
