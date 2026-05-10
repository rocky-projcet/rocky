import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeJson } from "../sessions/session-store.js";
import type { EcountConnectionTestInput } from "./ecount-connection-service.js";

export interface EcountConnectionSettingsInput extends EcountConnectionTestInput {
  checkedAt?: string | null;
}

export interface EcountConnectionSettingsRecord {
  configured: boolean;
  accountLabel: string | null;
  comCodeMasked: string | null;
  userIdMasked: string | null;
  apiCertKeyMasked: string | null;
  zone: string | null;
  checkedAt: string | null;
  updatedAt: string | null;
}

export interface EcountSettingsServiceLike {
  getPublicSettings(): Promise<EcountConnectionSettingsRecord>;
  getConnectionInput(): Promise<EcountConnectionTestInput | null>;
  saveSettings(input: EcountConnectionSettingsInput): Promise<EcountConnectionSettingsRecord>;
  updateLastCheck(input: {
    zone?: string | null;
    checkedAt: string;
  }): Promise<EcountConnectionSettingsRecord>;
  deleteSettings(): Promise<EcountConnectionSettingsRecord>;
}

export interface EcountSettingsServiceOptions {
  stateRoot?: string;
  now?: () => string;
}

interface EncryptedPayload {
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface PersistedEcountSettings {
  version: 1;
  accountLabel: string | null;
  zone: string | null;
  checkedAt: string | null;
  updatedAt: string;
  secret: EncryptedPayload;
}

interface SecretEcountSettings {
  comCode: string;
  userId: string;
  apiCertKey: string;
  lanType: string;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveStateRoot(stateRoot?: string): string {
  return path.resolve(
    stateRoot ?? path.join(process.cwd(), ".runtime", "agent-engine")
  );
}

function trimOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw Object.assign(new Error(`ECOUNT settings require ${label}.`), {
      statusCode: 400,
    });
  }
  return trimmed;
}

function maskValue(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 8))}${value.slice(-2)}`;
}

export class EcountSettingsService implements EcountSettingsServiceLike {
  private readonly stateRoot: string;
  private readonly now: () => string;

  constructor(options: EcountSettingsServiceOptions = {}) {
    this.stateRoot = resolveStateRoot(options.stateRoot);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async getPublicSettings(): Promise<EcountConnectionSettingsRecord> {
    const stored = await this.readStoredSettings();
    if (!stored) return emptySettingsRecord();

    const secret = await this.decryptSecret(stored.secret);
    return {
      configured: true,
      accountLabel: stored.accountLabel,
      comCodeMasked: maskValue(secret.comCode),
      userIdMasked: maskValue(secret.userId),
      apiCertKeyMasked: maskValue(secret.apiCertKey),
      zone: stored.zone,
      checkedAt: stored.checkedAt,
      updatedAt: stored.updatedAt,
    };
  }

  async getConnectionInput(): Promise<EcountConnectionTestInput | null> {
    const stored = await this.readStoredSettings();
    if (!stored) return null;

    const secret = await this.decryptSecret(stored.secret);
    return {
      accountLabel: stored.accountLabel,
      comCode: secret.comCode,
      userId: secret.userId,
      apiCertKey: secret.apiCertKey,
      zone: stored.zone,
      lanType: secret.lanType,
    };
  }

  async saveSettings(
    input: EcountConnectionSettingsInput
  ): Promise<EcountConnectionSettingsRecord> {
    const timestamp = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const zone = trimOptional(input.zone);
    const secret: SecretEcountSettings = {
      comCode: requireTrimmed(input.comCode, "comCode"),
      userId: requireTrimmed(input.userId, "userId"),
      apiCertKey: requireTrimmed(input.apiCertKey, "apiCertKey"),
      lanType: trimOptional(input.lanType) ?? "ko-KR",
    };

    const stored: PersistedEcountSettings = {
      version: 1,
      accountLabel,
      zone,
      checkedAt: input.checkedAt ?? null,
      updatedAt: timestamp,
      secret: await this.encryptSecret(secret),
    };

    await mkdir(this.settingsDir(), { recursive: true });
    await writeFile(this.settingsPath(), serializeJson(stored), "utf8");
    return this.getPublicSettings();
  }

  async updateLastCheck(input: {
    zone?: string | null;
    checkedAt: string;
  }): Promise<EcountConnectionSettingsRecord> {
    const stored = await this.readStoredSettings();
    if (!stored) return emptySettingsRecord();

    const next: PersistedEcountSettings = {
      ...stored,
      zone: trimOptional(input.zone) ?? stored.zone,
      checkedAt: input.checkedAt,
      updatedAt: this.now(),
    };
    await writeFile(this.settingsPath(), serializeJson(next), "utf8");
    return this.getPublicSettings();
  }

  async deleteSettings(): Promise<EcountConnectionSettingsRecord> {
    await rm(this.settingsPath(), { force: true });
    return emptySettingsRecord();
  }

  private async readStoredSettings(): Promise<PersistedEcountSettings | null> {
    if (!(await pathExists(this.settingsPath()))) return null;
    const parsed = JSON.parse(await readFile(this.settingsPath(), "utf8")) as Partial<PersistedEcountSettings>;
    if (parsed.version !== 1 || !parsed.secret) return null;
    return parsed as PersistedEcountSettings;
  }

  private async encryptSecret(secret: SecretEcountSettings): Promise<EncryptedPayload> {
    const key = await this.readOrCreateKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secret), "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  private async decryptSecret(payload: EncryptedPayload): Promise<SecretEcountSettings> {
    const key = await this.readOrCreateKey();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as SecretEcountSettings;
  }

  private async readOrCreateKey(): Promise<Buffer> {
    await mkdir(this.settingsDir(), { recursive: true });
    if (await pathExists(this.keyPath())) {
      return Buffer.from((await readFile(this.keyPath(), "utf8")).trim(), "base64");
    }

    const key = randomBytes(32);
    await writeFile(this.keyPath(), key.toString("base64"), {
      encoding: "utf8",
      mode: 0o600,
    });
    return key;
  }

  private settingsDir(): string {
    return path.join(this.stateRoot, "integrations", "ecount");
  }

  private settingsPath(): string {
    return path.join(this.settingsDir(), "settings.json");
  }

  private keyPath(): string {
    return path.join(this.settingsDir(), "settings.key");
  }
}

function emptySettingsRecord(): EcountConnectionSettingsRecord {
  return {
    configured: false,
    accountLabel: null,
    comCodeMasked: null,
    userIdMasked: null,
    apiCertKeyMasked: null,
    zone: null,
    checkedAt: null,
    updatedAt: null,
  };
}
