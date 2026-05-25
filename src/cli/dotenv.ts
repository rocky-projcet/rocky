import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface LoadDotenvOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fileName?: string;
}

export function loadDotenvFile(options: LoadDotenvOptions = {}): string | null {
  const env = options.env ?? process.env;
  if (isTruthy(env.ROCKY_DISABLE_DOTENV)) {
    return null;
  }

  const cwd = options.cwd ?? process.cwd();
  const configuredPath = env.ROCKY_DOTENV_PATH?.trim();
  const envPath = configuredPath
    ? path.resolve(cwd, configuredPath)
    : path.join(cwd, options.fileName ?? ".env");

  if (!existsSync(envPath)) {
    return null;
  }

  const entries = parseDotenv(readFileSync(envPath, "utf8"));
  for (const [key, value] of entries) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
  return envPath;
}

export function parseDotenv(content: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const lines = content.replace(/^\uFEFF/u, "").split(/\r?\n/u);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const line = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }

    entries.push([key, parseDotenvValue(line.slice(separatorIndex + 1))]);
  }

  return entries;
}

function parseDotenvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const unquoted = value.slice(1, -1);
    return value.startsWith('"') ? unescapeDoubleQuotedValue(unquoted) : unquoted;
  }

  const commentIndex = value.search(/\s#/u);
  return (commentIndex === -1 ? value : value.slice(0, commentIndex)).trimEnd();
}

function unescapeDoubleQuotedValue(value: string): string {
  return value.replace(/\\([nrt"\\])/gu, (_match, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return escaped;
    }
  });
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}
