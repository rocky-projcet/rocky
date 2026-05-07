export type FavoriteKind = "output-file" | "agent-message" | "task";

export interface FavoriteRecord {
  id: string;
  kind: FavoriteKind;
  chatId: string;
  runId: string | null;
  artifactId: string | null;
  messageId: string | null;
  createdAt: string;
}

export interface FavoriteCreateInput {
  kind: FavoriteKind;
  chatId: string;
  runId?: string | null;
  artifactId?: string | null;
  messageId?: string | null;
}

export interface FavoriteServiceLike {
  list(): Promise<FavoriteRecord[]>;
  add(input: FavoriteCreateInput): Promise<FavoriteRecord>;
  remove(id: string): Promise<{ id: string; deleted: boolean }>;
}
