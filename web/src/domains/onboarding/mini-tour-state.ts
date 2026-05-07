const STORAGE_PREFIX = "rocky.mini-tour.v1.";

export type MiniTourKey =
  | "agent-new"
  | "skill-templates"
  | "skill-wizard"
  | "task-composer";

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function hasMiniTourFired(key: MiniTourKey): boolean {
  if (!isBrowserStorageAvailable()) return false;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`) === "fired";
  } catch {
    return false;
  }
}

export function markMiniTourFired(key: MiniTourKey): void {
  if (!isBrowserStorageAvailable()) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, "fired");
  } catch {
    // ignore
  }
}

export function resetMiniTours(): void {
  if (!isBrowserStorageAvailable()) return;
  const keys: MiniTourKey[] = [
    "agent-new",
    "skill-templates",
    "skill-wizard",
    "task-composer",
  ];
  for (const key of keys) {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  }
}
