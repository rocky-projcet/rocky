import { useEffect, useState } from "react";

const STORAGE_KEY = "rocky.task-agents.v1";

type TaskAgentMap = Record<string, string>;

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readMap(): TaskAgentMap {
  if (!isBrowserStorageAvailable()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const next: TaskAgentMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        next[key] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function writeMap(map: TaskAgentMap): void {
  if (!isBrowserStorageAvailable()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function rememberTaskAgent(taskId: string, agentId: string): void {
  const map = readMap();
  map[taskId] = agentId;
  writeMap(map);
}

export function readTaskAgentId(taskId: string): string | null {
  return readMap()[taskId] ?? null;
}

export function readAllTaskAgentMap(): TaskAgentMap {
  return readMap();
}

export function useTaskAgentId(taskId: string | undefined): string | null {
  const [map, setMap] = useState<TaskAgentMap>(readMap);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) {
        setMap(readMap());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  if (!taskId) return null;
  return map[taskId] ?? null;
}
