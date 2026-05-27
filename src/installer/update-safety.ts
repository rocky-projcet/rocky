export const preservedInstallPathNames = [
  ".runtime",
  ".codex",
  ".tools",
  ".rocky-env.ps1",
  ".env",
  ".env.local",
] as const;

export function normalizeInstallerRelativePath(relativePath: string): string[] {
  return relativePath
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isPreservedInstallPath(relativePath: string): boolean {
  const parts = normalizeInstallerRelativePath(relativePath);
  if (parts.length === 0) {
    return false;
  }

  const root = parts[0]?.toLowerCase();
  return preservedInstallPathNames.some((name) => name.toLowerCase() === root);
}

export function createUpdateBackupDirectoryName(date = new Date()): string {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  return `.rocky-update-backup-${timestamp}`;
}
