import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const bundleMetadata = {
  CFBundleDisplayName: "Rocky",
  CFBundleExecutable: "Rocky",
  CFBundleIconFile: "Rocky.icns",
  CFBundleIdentifier: "works.earendil.rocky",
  CFBundleName: "Rocky",
};

function plist(version) {
  const normalizedVersion = version.replace(/^v/, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Rocky</string>
  <key>CFBundleExecutable</key>
  <string>Rocky</string>
  <key>CFBundleIconFile</key>
  <string>Rocky.icns</string>
  <key>CFBundleIdentifier</key>
  <string>works.earendil.rocky</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Rocky</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${normalizedVersion}</string>
  <key>CFBundleVersion</key>
  <string>${normalizedVersion}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
</dict>
</plist>
`;
}

async function assertFile(filePath, label) {
  try {
    const file = await stat(filePath);
    if (!file.isFile()) {
      throw new Error(`${label} is not a file: ${filePath}`);
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(`${label} is missing: ${filePath}`);
    }
    throw error;
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function assertMetadata(plistContents, key, value) {
  const entry = `<key>${key}</key>\n  <string>${value}</string>`;
  if (!plistContents.includes(entry)) {
    throw new Error(`Info.plist must set ${key} to ${value}.`);
  }
}

export async function brandMacOSAppBundle({ appRoot, iconSourcePath, version }) {
  const contentsRoot = path.join(appRoot, "Contents");
  const macosRoot = path.join(contentsRoot, "MacOS");
  const resourcesRoot = path.join(contentsRoot, "Resources");

  await rename(path.join(macosRoot, "Electron"), path.join(macosRoot, "Rocky"));
  await mkdir(resourcesRoot, { recursive: true });
  await copyFile(iconSourcePath, path.join(resourcesRoot, "Rocky.icns"));
  await writeFile(path.join(contentsRoot, "Info.plist"), plist(version), "utf8");
}

export async function validateMacOSAppBundle(appRoot) {
  const contentsRoot = path.join(appRoot, "Contents");
  const macosRoot = path.join(contentsRoot, "MacOS");
  const plistPath = path.join(contentsRoot, "Info.plist");

  await assertFile(path.join(macosRoot, "Rocky"), "Rocky executable");
  await assertFile(path.join(contentsRoot, "Resources", "Rocky.icns"), "Rocky icon");

  if (await exists(path.join(macosRoot, "Electron"))) {
    throw new Error(`Electron executable must not exist: ${path.join(macosRoot, "Electron")}`);
  }

  const plistContents = await readFile(plistPath, "utf8");
  for (const [key, value] of Object.entries(bundleMetadata)) {
    assertMetadata(plistContents, key, value);
  }
}
