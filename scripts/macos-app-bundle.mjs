import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const bundleMetadata = {
  CFBundleDisplayName: "Rocky",
  CFBundleExecutable: "Rocky",
  CFBundleIconFile: "Rocky.icns",
  CFBundleIdentifier: "works.earendil.rocky",
  CFBundleName: "Rocky",
};

const helperBundles = [
  {
    electronName: "Electron Helper",
    rockyName: "Rocky Helper",
    identifier: "works.earendil.rocky.helper",
  },
  {
    electronName: "Electron Helper (GPU)",
    rockyName: "Rocky Helper (GPU)",
    identifier: "works.earendil.rocky.helper.gpu",
  },
  {
    electronName: "Electron Helper (Plugin)",
    rockyName: "Rocky Helper (Plugin)",
    identifier: "works.earendil.rocky.helper.plugin",
  },
  {
    electronName: "Electron Helper (Renderer)",
    rockyName: "Rocky Helper (Renderer)",
    identifier: "works.earendil.rocky.helper.renderer",
  },
];

const electronHelperNames = new Set(
  helperBundles.flatMap(({ electronName }) => [electronName, `${electronName}.app`])
);

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
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function assertMetadata(plistContents, key, value) {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const entry = new RegExp(
    `<key>${key}</key>\\s*<string>${escapedValue}</string>`,
    "u"
  );
  if (!entry.test(plistContents)) {
    throw new Error(`Info.plist must set ${key} to ${value}.`);
  }
}

function setMetadata(plistContents, key, value) {
  const entry = new RegExp(
    `(<key>${key}</key>\\s*<string>)[^<]*(</string>)`,
    "u"
  );
  if (entry.test(plistContents)) {
    return plistContents.replace(entry, (_match, prefix, suffix) => {
      return `${prefix}${value}${suffix}`;
    });
  }
  const dictionaryEnd = plistContents.lastIndexOf("</dict>");
  if (dictionaryEnd === -1) {
    throw new Error(`Info.plist is missing its root dictionary while setting ${key}.`);
  }
  const metadataEntry = `\t<key>${key}</key>\n\t<string>${value}</string>\n`;
  return (
    plistContents.slice(0, dictionaryEnd) +
    metadataEntry +
    plistContents.slice(dictionaryEnd)
  );
}

async function brandHelperBundle(frameworksRoot, helper) {
  const electronAppRoot = path.join(frameworksRoot, `${helper.electronName}.app`);
  const rockyAppRoot = path.join(frameworksRoot, `${helper.rockyName}.app`);
  await rename(electronAppRoot, rockyAppRoot);

  const macosRoot = path.join(rockyAppRoot, "Contents", "MacOS");
  await rename(
    path.join(macosRoot, helper.electronName),
    path.join(macosRoot, helper.rockyName)
  );

  const plistPath = path.join(rockyAppRoot, "Contents", "Info.plist");
  let plistContents = await readFile(plistPath, "utf8");
  const metadata = {
    CFBundleDisplayName: helper.rockyName,
    CFBundleExecutable: helper.rockyName,
    CFBundleIdentifier: helper.identifier,
    CFBundleName: helper.rockyName,
  };
  for (const [key, value] of Object.entries(metadata)) {
    plistContents = setMetadata(plistContents, key, value);
  }
  await writeFile(plistPath, plistContents, "utf8");
}

async function validateBundleTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (electronHelperNames.has(entry.name)) {
      throw new Error(`Electron-named helper must not exist: ${entryPath}`);
    }
    if (entry.isSymbolicLink()) {
      const target = await readlink(entryPath);
      if (path.isAbsolute(target)) {
        throw new Error(
          `App bundle contains an absolute symbolic link: ${entryPath} -> ${target}`
        );
      }
      continue;
    }
    if (entry.isDirectory()) {
      await validateBundleTree(entryPath);
    }
  }
}

export async function copyMacOSAppBundle(source, target) {
  await cp(source, target, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });
}

export async function brandMacOSAppBundle({ appRoot, iconSourcePath, version }) {
  const contentsRoot = path.join(appRoot, "Contents");
  const macosRoot = path.join(contentsRoot, "MacOS");
  const frameworksRoot = path.join(contentsRoot, "Frameworks");
  const resourcesRoot = path.join(contentsRoot, "Resources");

  await rename(path.join(macosRoot, "Electron"), path.join(macosRoot, "Rocky"));
  for (const helper of helperBundles) {
    await brandHelperBundle(frameworksRoot, helper);
  }
  await mkdir(resourcesRoot, { recursive: true });
  await copyFile(iconSourcePath, path.join(resourcesRoot, "Rocky.icns"));
  await writeFile(path.join(contentsRoot, "Info.plist"), plist(version), "utf8");
}

export async function validateMacOSAppBundle(appRoot) {
  const contentsRoot = path.join(appRoot, "Contents");
  const frameworksRoot = path.join(contentsRoot, "Frameworks");
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

  for (const helper of helperBundles) {
    const helperRoot = path.join(
      frameworksRoot,
      `${helper.rockyName}.app`,
      "Contents"
    );
    await assertFile(
      path.join(helperRoot, "MacOS", helper.rockyName),
      `${helper.rockyName} executable`
    );
    const helperPlistContents = await readFile(
      path.join(helperRoot, "Info.plist"),
      "utf8"
    );
    const metadata = {
      CFBundleDisplayName: helper.rockyName,
      CFBundleExecutable: helper.rockyName,
      CFBundleIdentifier: helper.identifier,
      CFBundleName: helper.rockyName,
    };
    for (const [key, value] of Object.entries(metadata)) {
      assertMetadata(helperPlistContents, key, value);
    }
  }

  await validateBundleTree(appRoot);
}
