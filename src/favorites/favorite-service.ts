import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type FavoriteCreateInput,
  type FavoriteKind,
  type FavoriteRecord,
  type FavoriteServiceLike,
} from "./favorite-types.js";

export interface FavoriteServiceOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
}

const SUPPORTED_KINDS: FavoriteKind[] = [
  "output-file",
  "agent-message",
  "task",
];

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function defaultIdGenerator(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `fav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class FavoriteService implements FavoriteServiceLike {
  private readonly stateRoot: string;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private records: FavoriteRecord[] = [];
  private hydrated = false;
  private hydratePromise: Promise<void> | null = null;

  constructor(options: FavoriteServiceOptions = {}) {
    this.stateRoot = options.stateRoot ?? path.resolve(".runtime", "agent-engine");
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async list(): Promise<FavoriteRecord[]> {
    await this.ensureHydrated();
    return this.records.map((record) => ({ ...record }));
  }

  async add(input: FavoriteCreateInput): Promise<FavoriteRecord> {
    await this.ensureHydrated();
    if (!SUPPORTED_KINDS.includes(input.kind)) {
      throw badRequest(`지원하지 않는 즐겨찾기 종류입니다: ${input.kind}`);
    }
    if (!input.chatId.trim()) {
      throw badRequest("chatId는 필수입니다.");
    }
    if (input.kind === "output-file") {
      if (!input.runId?.trim() || !input.artifactId?.trim()) {
        throw badRequest("결과 파일 즐겨찾기는 runId와 artifactId가 필요합니다.");
      }
    }
    if (input.kind === "agent-message") {
      if (!input.messageId?.trim()) {
        throw badRequest("답변 즐겨찾기는 messageId가 필요합니다.");
      }
    }

    const existing = this.findExisting(input);
    if (existing) {
      return { ...existing };
    }

    const record: FavoriteRecord = {
      id: this.idGenerator(),
      kind: input.kind,
      chatId: input.chatId.trim(),
      runId: input.runId?.trim() ?? null,
      artifactId: input.artifactId?.trim() ?? null,
      messageId: input.messageId?.trim() ?? null,
      createdAt: this.now(),
    };
    this.records = [record, ...this.records];
    await this.persist();
    return { ...record };
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    await this.ensureHydrated();
    const before = this.records.length;
    this.records = this.records.filter((record) => record.id !== id);
    const deleted = this.records.length < before;
    if (deleted) {
      await this.persist();
    }
    return { id, deleted };
  }

  private findExisting(input: FavoriteCreateInput): FavoriteRecord | null {
    return (
      this.records.find((record) => {
        if (record.kind !== input.kind) return false;
        if (record.chatId !== input.chatId.trim()) return false;
        if (input.kind === "output-file") {
          return (
            record.runId === (input.runId?.trim() ?? null) &&
            record.artifactId === (input.artifactId?.trim() ?? null)
          );
        }
        if (input.kind === "agent-message") {
          return record.messageId === (input.messageId?.trim() ?? null);
        }
        return true; // for task, chatId match is enough
      }) ?? null
    );
  }

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated) return;
    if (!this.hydratePromise) {
      this.hydratePromise = this.hydrate();
    }
    await this.hydratePromise;
  }

  private async hydrate(): Promise<void> {
    const file = this.indexPath();
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.records = parsed.filter(isFavoriteRecord);
      }
    } catch {
      // No prior favorites file.
    }
    this.hydrated = true;
  }

  private async persist(): Promise<void> {
    const dir = path.join(this.stateRoot, "favorites");
    await mkdir(dir, { recursive: true });
    await writeFile(this.indexPath(), JSON.stringify(this.records), "utf8");
  }

  private indexPath(): string {
    return path.join(this.stateRoot, "favorites", "index.json");
  }
}

function isFavoriteRecord(value: unknown): value is FavoriteRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<FavoriteRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.chatId === "string" &&
    typeof record.createdAt === "string" &&
    SUPPORTED_KINDS.includes(record.kind as FavoriteKind)
  );
}
