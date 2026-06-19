import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeJson } from "../sessions/session-store.js";
import {
  DEFAULT_ECOUNT_SERVER_TYPE,
  normalizeEcountServerType,
  type EcountConnectionTestInput,
  type EcountServerType,
} from "./ecount-connection-service.js";
import type { EcountWebLoginInput } from "./ecount-browser-sales-export.js";

export interface EcountConnectionSettingsInput extends EcountConnectionTestInput {
  checkedAt?: string | null;
}

export interface EcountWebLoginSettingsInput {
  accountLabel?: string | null;
  comCode?: string | null;
  userId: string;
  password: string;
  lanType?: string | null;
}

export interface EcountConnectionSettingsRecord {
  configured: boolean;
  accountLabel: string | null;
  comCodeMasked: string | null;
  userIdMasked: string | null;
  apiCertKeyMasked: string | null;
  zone: string | null;
  serverType: EcountServerType;
  checkedAt: string | null;
  updatedAt: string | null;
  webLoginConfigured: boolean;
  webUserIdMasked: string | null;
  webLoginUpdatedAt: string | null;
}

export interface EcountSettingsServiceLike {
  getPublicSettings(): Promise<EcountConnectionSettingsRecord>;
  getConnectionInput(): Promise<EcountConnectionTestInput | null>;
  getWebLoginInput(): Promise<EcountWebLoginInput | null>;
  saveSettings(input: EcountConnectionSettingsInput): Promise<EcountConnectionSettingsRecord>;
  saveWebLogin(input: EcountWebLoginSettingsInput): Promise<EcountConnectionSettingsRecord>;
  updateLastCheck(input: {
    zone?: string | null;
    checkedAt: string;
  }): Promise<EcountConnectionSettingsRecord>;
  deleteSettings(): Promise<EcountConnectionSettingsRecord>;
  deleteWebLogin(): Promise<EcountConnectionSettingsRecord>;
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
  serverType?: EcountServerType | null;
  checkedAt: string | null;
  updatedAt: string;
  secret: EncryptedPayload;
}

interface PersistedEcountWebLoginSettings {
  version: 1;
  accountLabel: string | null;
  updatedAt: string;
  secret: EncryptedPayload;
}

interface SecretEcountSettings {
  comCode: string;
  userId: string;
  apiCertKey: string;
  lanType: string;
}

interface SecretEcountWebLoginSettings {
  comCode: string;
  userId: string;
  password: string;
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
    const webLogin = await this.readStoredWebLoginSettings();
    if (!stored && !webLogin) return emptySettingsRecord();

    const secret = stored ? await this.decryptSecret(stored.secret) : null;
    const webSecret = webLogin ? await this.decryptWebLoginSecret(webLogin.secret) : null;
    return {
      configured: Boolean(stored),
      accountLabel: stored?.accountLabel ?? webLogin?.accountLabel ?? null,
      comCodeMasked: maskValue(secret?.comCode ?? webSecret?.comCode ?? null),
      userIdMasked: maskValue(secret?.userId ?? null),
      apiCertKeyMasked: maskValue(secret?.apiCertKey ?? null),
      zone: stored?.zone ?? null,
      serverType: normalizeEcountServerType(stored?.serverType),
      checkedAt: stored?.checkedAt ?? null,
      updatedAt: stored?.updatedAt ?? null,
      webLoginConfigured: Boolean(webLogin),
      webUserIdMasked: maskValue(webSecret?.userId ?? null),
      webLoginUpdatedAt: webLogin?.updatedAt ?? null,
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
      serverType: normalizeEcountServerType(stored.serverType),
    };
  }

  async getWebLoginInput(): Promise<EcountWebLoginInput | null> {
    const stored = await this.readStoredWebLoginSettings();
    if (!stored) return null;

    const secret = await this.decryptWebLoginSecret(stored.secret);
    return {
      accountLabel: stored.accountLabel,
      comCode: secret.comCode,
      userId: secret.userId,
      password: secret.password,
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
      serverType: normalizeEcountServerType(input.serverType),
      checkedAt: input.checkedAt ?? null,
      updatedAt: timestamp,
      secret: await this.encryptSecret(secret),
    };

    await mkdir(this.settingsDir(), { recursive: true });
    await writeFile(this.settingsPath(), serializeJson(stored), "utf8");
    return this.getPublicSettings();
  }

  async saveWebLogin(
    input: EcountWebLoginSettingsInput
  ): Promise<EcountConnectionSettingsRecord> {
    const timestamp = this.now();
    const storedApi = await this.readStoredSettings();
    const apiSecret = storedApi ? await this.decryptSecret(storedApi.secret) : null;
    const accountLabel = trimOptional(input.accountLabel) ?? storedApi?.accountLabel ?? null;
    const secret: SecretEcountWebLoginSettings = {
      comCode: trimOptional(input.comCode) ?? apiSecret?.comCode ?? requireTrimmed("", "web comCode"),
      userId: requireTrimmed(input.userId, "web userId"),
      password: requireTrimmed(input.password, "web password"),
      lanType: trimOptional(input.lanType) ?? "ko-KR",
    };

    const stored: PersistedEcountWebLoginSettings = {
      version: 1,
      accountLabel,
      updatedAt: timestamp,
      secret: await this.encryptWebLoginSecret(secret),
    };

    await mkdir(this.settingsDir(), { recursive: true });
    await writeFile(this.webLoginSettingsPath(), serializeJson(stored), "utf8");
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
      serverType: normalizeEcountServerType(stored.serverType),
      checkedAt: input.checkedAt,
      updatedAt: this.now(),
    };
    await writeFile(this.settingsPath(), serializeJson(next), "utf8");
    return this.getPublicSettings();
  }

  async deleteSettings(): Promise<EcountConnectionSettingsRecord> {
    await rm(this.settingsPath(), { force: true });
    await rm(this.webLoginSettingsPath(), { force: true });
    return emptySettingsRecord();
  }

  async deleteWebLogin(): Promise<EcountConnectionSettingsRecord> {
    await rm(this.webLoginSettingsPath(), { force: true });
    return this.getPublicSettings();
  }

  private async readStoredSettings(): Promise<PersistedEcountSettings | null> {
    if (!(await pathExists(this.settingsPath()))) return null;
    const parsed = JSON.parse(await readFile(this.settingsPath(), "utf8")) as Partial<PersistedEcountSettings>;
    if (parsed.version !== 1 || !parsed.secret) return null;
    return parsed as PersistedEcountSettings;
  }

  private async readStoredWebLoginSettings(): Promise<PersistedEcountWebLoginSettings | null> {
    if (!(await pathExists(this.webLoginSettingsPath()))) return null;
    const parsed = JSON.parse(await readFile(this.webLoginSettingsPath(), "utf8")) as Partial<PersistedEcountWebLoginSettings>;
    if (parsed.version !== 1 || !parsed.secret) return null;
    return parsed as PersistedEcountWebLoginSettings;
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
    return this.decryptPayload<SecretEcountSettings>(payload);
  }

  private async encryptWebLoginSecret(secret: SecretEcountWebLoginSettings): Promise<EncryptedPayload> {
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

  private async decryptWebLoginSecret(payload: EncryptedPayload): Promise<SecretEcountWebLoginSettings> {
    return this.decryptPayload<SecretEcountWebLoginSettings>(payload);
  }

  private async decryptPayload<T>(payload: EncryptedPayload): Promise<T> {
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
    return JSON.parse(plaintext) as T;
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

  private webLoginSettingsPath(): string {
    return path.join(this.settingsDir(), "web-login.json");
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
    serverType: DEFAULT_ECOUNT_SERVER_TYPE,
    checkedAt: null,
    updatedAt: null,
    webLoginConfigured: false,
    webUserIdMasked: null,
    webLoginUpdatedAt: null,
  };
}
