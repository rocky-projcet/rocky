import path from "node:path";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

import { readJsonFile, serializeJson } from "../sessions/session-store.js";

import type {
  RockyChatRecord,
  RockyWorkerRecord,
} from "./rocky-chat-types.js";

function resolveRockyStateRoot(stateRoot?: string): string {
  return path.resolve(
    stateRoot ?? path.join(process.cwd(), ".runtime", "agent-engine")
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface RockyChatPaths {
  root: string;
  chatsRoot: string;
  chatRoot: string;
  chatPath: string;
}

export interface RockyWorkerPaths {
  root: string;
  workersRoot: string;
  workerPath: string;
}

export function resolveRockyChatPaths({
  stateRoot,
  chatId,
}: {
  stateRoot?: string;
  chatId: string;
}): RockyChatPaths {
  const root = path.join(resolveRockyStateRoot(stateRoot), "rocky-chat");
  const chatsRoot = path.join(root, "chats");
  const chatRoot = path.join(chatsRoot, chatId);

  return {
    root,
    chatsRoot,
    chatRoot,
    chatPath: path.join(chatRoot, "chat.json"),
  };
}

export function resolveRockyWorkerPaths({
  stateRoot,
  workerId,
}: {
  stateRoot?: string;
  workerId: string;
}): RockyWorkerPaths {
  const root = path.join(resolveRockyStateRoot(stateRoot), "rocky-chat");
  const workersRoot = path.join(root, "workers");

  return {
    root,
    workersRoot,
    workerPath: path.join(workersRoot, `${workerId}.json`),
  };
}

export async function writeRockyChatRecord(
  paths: RockyChatPaths,
  chat: RockyChatRecord
): Promise<void> {
  await mkdir(paths.chatRoot, { recursive: true });
  await writeFile(paths.chatPath, serializeJson(chat), "utf8");
}

export async function readRockyChatRecord(
  paths: RockyChatPaths
): Promise<RockyChatRecord | null> {
  if (!(await pathExists(paths.chatPath))) {
    return null;
  }

  return readJsonFile<RockyChatRecord>(paths.chatPath);
}

export async function listRockyChatPaths(
  stateRoot?: string
): Promise<RockyChatPaths[]> {
  const { chatsRoot } = resolveRockyChatPaths({
    stateRoot,
    chatId: "__placeholder__",
  });

  if (!(await pathExists(chatsRoot))) {
    return [];
  }

  const entries = await readdir(chatsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      resolveRockyChatPaths({
        stateRoot,
        chatId: entry.name,
      })
    );
}

export async function writeRockyWorkerRecord(
  paths: RockyWorkerPaths,
  worker: RockyWorkerRecord
): Promise<void> {
  await mkdir(paths.workersRoot, { recursive: true });
  await writeFile(paths.workerPath, serializeJson(worker), "utf8");
}

export async function readRockyWorkerRecord(
  paths: RockyWorkerPaths
): Promise<RockyWorkerRecord | null> {
  if (!(await pathExists(paths.workerPath))) {
    return null;
  }

  return readJsonFile<RockyWorkerRecord>(paths.workerPath);
}
