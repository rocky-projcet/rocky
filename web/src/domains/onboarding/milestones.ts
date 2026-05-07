import confetti from "canvas-confetti";

const STORAGE_PREFIX = "rocky.milestone.v1.";
const EVENT_NAME = "rocky:milestone";

export type MilestoneKey = string;

export interface MilestoneOptions {
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  durationMs?: number;
}

export interface MilestoneEventDetail {
  key: MilestoneKey;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  durationMs: number;
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function hasFired(key: MilestoneKey): boolean {
  if (!isBrowserStorageAvailable()) return false;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`) === "fired";
  } catch {
    return false;
  }
}

function markFired(key: MilestoneKey): void {
  if (!isBrowserStorageAvailable()) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, "fired");
  } catch {
    // ignore
  }
}

function shootConfetti(): void {
  if (typeof window === "undefined") return;
  const duration = 1400;
  const animationEnd = Date.now() + duration;
  const defaults = {
    startVelocity: 38,
    spread: 360,
    ticks: 70,
    zIndex: 100000,
    disableForReducedMotion: true,
  } as const;

  const interval = window.setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) {
      window.clearInterval(interval);
      return;
    }
    const particleCount = 60 * (timeLeft / duration);
    confetti({
      ...defaults,
      particleCount,
      origin: { x: Math.random() * 0.4 + 0.1, y: Math.random() * 0.3 + 0.1 },
    });
    confetti({
      ...defaults,
      particleCount,
      origin: { x: Math.random() * 0.4 + 0.5, y: Math.random() * 0.3 + 0.1 },
    });
  }, 220);
}

/**
 * Fire a one-time milestone celebration: confetti burst + a centered
 * celebration card (rendered by MilestoneHost). Subsequent calls with
 * the same key are no-ops. Returns true if the celebration fired.
 */
export function fireMilestone(
  key: MilestoneKey,
  options: MilestoneOptions,
): boolean {
  if (hasFired(key)) return false;
  markFired(key);
  shootConfetti();
  if (typeof window !== "undefined") {
    const detail: MilestoneEventDetail = {
      key,
      title: options.title,
      description: options.description,
      action: options.action,
      durationMs: options.durationMs ?? 6000,
    };
    window.dispatchEvent(new CustomEvent<MilestoneEventDetail>(EVENT_NAME, { detail }));
  }
  return true;
}

export function resetMilestones(): void {
  if (!isBrowserStorageAvailable()) return;
  const keys: MilestoneKey[] = ["first-agent", "first-skill", "first-task"];
  for (const key of keys) {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  }
  // Also strip per-agent level-up flags.
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(`${STORAGE_PREFIX}agent-levelup:`)) {
        stale.push(key);
      }
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Fire a celebration when an agent reaches a new level (level >= 2).
 * Each (agentId, level) pair fires at most once, even across reloads.
 */
export function fireAgentLevelUp(input: {
  agentId: string;
  agentName: string;
  level: number;
}): boolean {
  if (input.level < 2) return false;
  const key = `agent-levelup:${input.agentId}:${input.level}`;
  return fireMilestone(key, {
    title: `🎊 ${input.agentName} Lv.${input.level} 달성!`,
    description: `직원이 작업을 ${(input.level - 1) * 5}회 완료해 한 단계 성장했어요. 다음 레벨까지 ${5}작업 더!`,
    durationMs: 7000,
  });
}

export const MILESTONE_EVENT = EVENT_NAME;
