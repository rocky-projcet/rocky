import { createHash } from "node:crypto";

export const PUBLIC_RELEASE_REPOSITORY = "rocky-projcet/rocky-release";

const RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/u;
const REQUIRED_RELEASE_NOTE_SECTIONS = [
  "Highlights",
  "Windows Install",
  "macOS Install",
  "Validation",
  "Checksums",
  "Known Limitations",
] as const;

export interface ReleaseTag {
  tag: string;
  version: string;
}

export interface ReleaseAssetBytes {
  name: string;
  bytes: Uint8Array;
}

export function parseReleaseTag(tag: string): ReleaseTag {
  const match = RELEASE_TAG_PATTERN.exec(tag.trim());
  if (!match) {
    throw new Error(`Release tag must be a leading v semver tag: ${tag}`);
  }

  return {
    tag: match[0],
    version: match[1],
  };
}

export function assertReleaseVersion(tag: string, packageVersion: string): void {
  const parsed = parseReleaseTag(tag);
  if (parsed.version !== packageVersion.trim()) {
    throw new Error(
      `Release tag ${parsed.tag} does not match package version ${packageVersion}.`
    );
  }
}

export function validateReleaseNotes(markdown: string, tag: string): void {
  if (!markdown.trim()) {
    throw new Error(`Release notes are empty for ${tag}.`);
  }

  for (const section of REQUIRED_RELEASE_NOTE_SECTIONS) {
    const heading = new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "mu");
    if (!heading.test(markdown)) {
      throw new Error(`Release notes for ${tag} are missing required section: ${section}.`);
    }
  }
}

export function expectedWindowsReleaseAssetNames(tag: string): {
  installer: string;
  checksums: string;
} {
  const { tag: normalizedTag } = parseReleaseTag(tag);
  return {
    installer: `Rocky-Setup-${normalizedTag}.exe`,
    checksums: "SHA256SUMS.txt",
  };
}

export function expectedMacOSReleaseAssetNames(tag: string): string[] {
  const { tag: normalizedTag } = parseReleaseTag(tag);
  return [
    `rocky-${normalizedTag}-macos-arm64.app.zip`,
    `rocky-${normalizedTag}-macos-arm64.dmg`,
    `rocky-${normalizedTag}-macos-arm64.pkg`,
    `rocky-${normalizedTag}-macos-x64.app.zip`,
    `rocky-${normalizedTag}-macos-x64.dmg`,
    `rocky-${normalizedTag}-macos-x64.pkg`,
  ];
}

export function expectedStableReleaseAssetNames(tag: string): string[] {
  const windows = expectedWindowsReleaseAssetNames(tag);
  return [
    windows.installer,
    windows.checksums,
    ...expectedMacOSReleaseAssetNames(tag),
  ].sort();
}

export function assertStableReleaseAssetNames(
  names: string[],
  tag: string
): void {
  const actual = [...new Set(names)].sort();
  const stable = expectedStableReleaseAssetNames(tag);
  if (actual.length !== stable.length || actual.some((name, index) => name !== stable[index])) {
    throw new Error(
      `Found unexpected stable release assets for ${stable.join(", ")}: ${actual.join(", ")}.`
    );
  }
}

export function createSha256Sums(entries: ReleaseAssetBytes[]): string {
  return [...entries]
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map(
      ({ name, bytes }) =>
        `${createHash("sha256").update(bytes).digest("hex")}  ${name}`
    )
    .join("\n") + "\n";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
