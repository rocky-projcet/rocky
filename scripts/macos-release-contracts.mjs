import { readFile } from "node:fs/promises";

function plistValues(plistContents, key, valuePattern) {
  const pattern = new RegExp(
    `<key>${key}</key>\\s*${valuePattern}`,
    "gu"
  );
  return [...plistContents.matchAll(pattern)].map((match) => match[1]);
}

export async function validatePkgComponentPlist(plistPath) {
  const plistContents = await readFile(plistPath, "utf8");
  const appRoot = "Applications/Rocky.app";
  const rootPaths = plistValues(
    plistContents,
    "RootRelativeBundlePath",
    "<string>([^<]+)</string>"
  );
  if (
    rootPaths.filter((rootPath) => rootPath === appRoot).length !== 1 ||
    rootPaths.some(
      (rootPath) => rootPath !== appRoot && !rootPath.startsWith(`${appRoot}/`)
    )
  ) {
    throw new Error(
      "PKG component RootRelativeBundlePath must be Applications/Rocky.app."
    );
  }

  const relocatableValues = plistValues(
    plistContents,
    "BundleIsRelocatable",
    "<(true|false)\\s*/>"
  );
  if (relocatableValues.length !== 1 || relocatableValues[0] !== "false") {
    throw new Error("PKG component BundleIsRelocatable must be false.");
  }
}

export function unsignedArtifactsNote(tag) {
  return `Note: artifacts are unsigned and not notarized for ${tag}.`;
}
