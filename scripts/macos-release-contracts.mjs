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
  const rootPaths = plistValues(
    plistContents,
    "RootRelativeBundlePath",
    "<string>([^<]+)</string>"
  );
  if (
    rootPaths.length !== 1 ||
    rootPaths[0] !== "Applications/Rocky.app"
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
