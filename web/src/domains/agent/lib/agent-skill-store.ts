import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "rocky.agent-skills.v1";

type AgentSkillMap = Record<string, string[]>;

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readMap(): AgentSkillMap {
  if (!isBrowserStorageAvailable()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const next: AgentSkillMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
        next[key] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function writeMap(map: AgentSkillMap): void {
  if (!isBrowserStorageAvailable()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function useAgentSkills(agentId: string | undefined) {
  const [map, setMap] = useState<AgentSkillMap>(readMap);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) {
        setMap(readMap());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const skillIds = agentId ? map[agentId] ?? [] : [];

  const setSkills = useCallback(
    (nextSkillIds: string[]) => {
      if (!agentId) return;
      setMap((current) => {
        const next = { ...current, [agentId]: nextSkillIds };
        writeMap(next);
        return next;
      });
    },
    [agentId],
  );

  const attachSkill = useCallback(
    (skillId: string) => {
      if (!agentId) return;
      setMap((current) => {
        const existing = current[agentId] ?? [];
        if (existing.includes(skillId)) return current;
        const next = { ...current, [agentId]: [...existing, skillId] };
        writeMap(next);
        return next;
      });
    },
    [agentId],
  );

  const detachSkill = useCallback(
    (skillId: string) => {
      if (!agentId) return;
      setMap((current) => {
        const existing = current[agentId] ?? [];
        if (!existing.includes(skillId)) return current;
        const next = { ...current, [agentId]: existing.filter((id) => id !== skillId) };
        writeMap(next);
        return next;
      });
    },
    [agentId],
  );

  return { skillIds, setSkills, attachSkill, detachSkill };
}

export function readAgentSkillIds(agentId: string): string[] {
  return readMap()[agentId] ?? [];
}
