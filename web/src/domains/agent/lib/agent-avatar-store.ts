import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "rocky.agent-avatars.v1";

type AgentAvatarMap = Record<string, string>;

export const AGENT_EMOJI_PRESETS: string[] = [
  "🦊",
  "🐱",
  "🐶",
  "🐻",
  "🐼",
  "🦁",
  "🐯",
  "🐨",
  "🐰",
  "🐹",
  "🦝",
  "🐺",
  "🦄",
  "🐉",
  "🦅",
  "🦉",
  "🐧",
  "🐢",
  "🐬",
  "🐙",
  "🦋",
  "🦔",
];

/** Pastel-friendly background tint options for the agent avatar. */
export const AGENT_AVATAR_COLORS: string[] = [
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#ec4899", // pink
  "#f43f5e", // rose
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
];

const FALLBACK_EMOJI_FOR_INITIAL = "🤖";

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readMap(): AgentAvatarMap {
  if (!isBrowserStorageAvailable()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const next: AgentAvatarMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0) {
        next[key] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function writeMap(map: AgentAvatarMap): void {
  if (!isBrowserStorageAvailable()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function defaultEmojiForAgent(agentId: string): string {
  if (!agentId) return FALLBACK_EMOJI_FOR_INITIAL;
  // Pick a stable preset based on agent id.
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return AGENT_EMOJI_PRESETS[hash % AGENT_EMOJI_PRESETS.length] ?? FALLBACK_EMOJI_FOR_INITIAL;
}

export function readAgentEmoji(agentId: string): string {
  const map = readMap();
  return map[agentId] ?? defaultEmojiForAgent(agentId);
}

export function writeAgentEmoji(agentId: string, emoji: string): void {
  const map = readMap();
  map[agentId] = emoji;
  writeMap(map);
}

export function useAgentEmoji(agentId: string | undefined) {
  const [map, setMap] = useState<AgentAvatarMap>(readMap);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) {
        setMap(readMap());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const emoji = agentId
    ? map[agentId] ?? defaultEmojiForAgent(agentId)
    : FALLBACK_EMOJI_FOR_INITIAL;

  const setEmoji = useCallback(
    (next: string) => {
      if (!agentId) return;
      setMap((current) => {
        const updated = { ...current, [agentId]: next };
        writeMap(updated);
        return updated;
      });
    },
    [agentId],
  );

  return { emoji, setEmoji };
}
