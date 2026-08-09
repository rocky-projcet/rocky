import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createGitHubReleaseClient,
} from "../src/release/github-release-client.js";
import {
  DualReleaseCoordinator,
  type ReleaseAssetInput,
} from "../src/release/github-release-coordinator.js";
import {
  assertReleaseVersion,
  assertStableReleaseAssetNames,
  createSha256Sums,
  expectedMacOSReleaseAssetNames,
  expectedWindowsReleaseAssetNames,
  parseReleaseTag,
  PUBLIC_RELEASE_REPOSITORY,
  validateReleaseNotes,
} from "../src/release/release-contracts.js";

const PRIVATE_RELEASE_REPOSITORY = "rocky-projcet/rocky";

interface CliOptions {
  tag: string;
  outputDirectory: string;
}

const options = parseArgs(process.argv.slice(2));
await run(options);

function parseArgs(args: string[]): CliOptions {
  let tag = process.env.GITHUB_REF_NAME ?? "";
  let outputDirectory = "";

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--tag") {
      tag = args[++index] ?? "";
    } else if (argument === "--output-directory") {
      outputDirectory = args[++index] ?? "";
    } else {
      throw new Error(`Unknown release argument: ${argument}`);
    }
  }

  const parsedTag = parseReleaseTag(tag);
  return {
    tag: parsedTag.tag,
    outputDirectory: outputDirectory || path.join("releases", parsedTag.tag),
  };
}

async function run(cli: CliOptions): Promise<void> {
  const parsedTag = parseReleaseTag(cli.tag);
  const packageJson = JSON.parse(
    await readFile("package.json", "utf8")
  ) as { version?: string };
  if (typeof packageJson.version !== "string") {
    throw new Error("package.json does not contain a version.");
  }
  assertReleaseVersion(parsedTag.tag, packageJson.version);

  const notesPath = path.join("docs", "releases", `${parsedTag.tag}.md`);
  const releaseNotes = await readFile(notesPath, "utf8");
  validateReleaseNotes(releaseNotes, parsedTag.tag);

  const windowsAssetNames = expectedWindowsReleaseAssetNames(parsedTag.tag);
  const macOSAssetNames = expectedMacOSReleaseAssetNames(parsedTag.tag);
  const installerNames = [windowsAssetNames.installer, ...macOSAssetNames];
  const checksumsPath = path.join(cli.outputDirectory, windowsAssetNames.checksums);
  const sourceFreePayloadPath = path.join(
    cli.outputDirectory,
    `rocky-${parsedTag.tag}-windows-app.zip`
  );
  for (const installerName of installerNames) {
    await assertFile(
      path.join(cli.outputDirectory, installerName),
      `Release installer ${installerName}`
    );
  }
  await assertFile(sourceFreePayloadPath, "source-free Windows payload");

  const installerEntries = await Promise.all(
    installerNames.map(async (name) => ({
      name,
      bytes: await readFile(path.join(cli.outputDirectory, name)),
    }))
  );
  const checksums = createSha256Sums(installerEntries);
  await writeDeterministicFile(checksumsPath, checksums);
  const checksumsBytes = Buffer.from(checksums, "utf8");
  const assets: ReleaseAssetInput[] = [
    ...installerEntries.map(({ name, bytes }) => ({
      name,
      bytes,
      sha256: sha256(bytes),
    })),
    {
      name: windowsAssetNames.checksums,
      bytes: checksumsBytes,
      sha256: sha256(checksumsBytes),
    },
  ];
  assertStableReleaseAssetNames(
    assets.map((asset) => asset.name),
    parsedTag.tag
  );

  const privateToken = requiredEnvironment("GITHUB_TOKEN");
  const publicToken = requiredEnvironment("PUBLIC_RELEASE_TOKEN");
  const privateClient = createGitHubReleaseClient({
    repositoryFullName: PRIVATE_RELEASE_REPOSITORY,
    token: privateToken,
  });
  const publicClient = createGitHubReleaseClient({
    repositoryFullName: PUBLIC_RELEASE_REPOSITORY,
    token: publicToken,
  });
  const result = await new DualReleaseCoordinator().publish({
    tag: parsedTag.tag,
    name: `Rocky ${parsedTag.tag}`,
    body: releaseNotes,
    assets,
    privateClient,
    publicClient,
    publicTargetCommitish: "main",
  });

  console.log(
    JSON.stringify({
      tag: parsedTag.tag,
      privateReleaseId: result.privateRelease.id,
      publicReleaseId: result.publicRelease.id,
      assets: assets.map((asset) => ({
        name: asset.name,
        size: asset.bytes.byteLength,
        sha256: asset.sha256,
      })),
    })
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertFile(filePath: string, label: string): Promise<void> {
  const metadata = await stat(filePath).catch(() => null);
  if (!metadata?.isFile()) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

async function writeDeterministicFile(
  filePath: string,
  contents: string
): Promise<void> {
  const existing = await readFile(filePath, "utf8").catch(() => null);
  if (existing !== null && existing !== contents) {
    throw new Error(`Existing checksum manifest does not match: ${filePath}`);
  }
  if (existing === null) {
    await writeFile(filePath, contents, "utf8");
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for dual GitHub Release publication.`);
  }
  return value;
}
