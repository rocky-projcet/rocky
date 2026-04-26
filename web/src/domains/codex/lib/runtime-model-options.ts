import type {
  RuntimeDescriptorRecord,
  RuntimeModelOption,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
} from "@/shared/lib/agent-engine-client";

export const runtimeModelLabel: Record<string, string> = {
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
  "gpt-5.2": "GPT-5.2",
  "gpt-5.4-nano": "GPT-5.4 nano",
  default: "Default (recommended) · Sonnet 4.6",
  "sonnet[1m]": "Sonnet (1M context) · Sonnet 4.6",
  opus: "Opus · Opus 4.6",
  "opus[1m]": "Opus (1M context) · Opus 4.6",
  haiku: "Haiku · Haiku 4.5",
  sonnet: "Claude Sonnet",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-opus-4-1": "Claude Opus 4.1",
  "claude-haiku-4-5": "Claude Haiku 4.5",
};

export const compactRuntimeModelLabel: Record<string, string> = {
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.3-codex-spark": "GPT-5.3 Spark",
  "gpt-5.2": "GPT-5.2",
  "gpt-5.4-nano": "GPT-5.4 nano",
  default: "Sonnet 4.6",
  "sonnet[1m]": "Sonnet 4.6 1M",
  opus: "Opus 4.6",
  "opus[1m]": "Opus 4.6 1M",
  haiku: "Haiku 4.5",
  sonnet: "Sonnet",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-opus-4-1": "Opus 4.1",
  "claude-haiku-4-5": "Haiku 4.5",
};

export const reasoningEffortLabel: Record<RuntimeReasoningEffort, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
  xhigh: "매우 높음",
  max: "최대",
};

export const serviceTierLabel: Record<RuntimeServiceTier | "default" | "flex", string> = {
  default: "기본",
  flex: "기본",
  fast: "Fast",
};
export const DEFAULT_SERVICE_TIER_SELECTION = "default";

export function formatRuntimeModelLabel(model: string | null | undefined): string {
  if (!model) {
    return "기본값";
  }

  return runtimeModelLabel[model] ?? model;
}

export function formatCompactRuntimeModelLabel(
  model: string | null | undefined
): string {
  if (!model) {
    return "기본값";
  }

  return compactRuntimeModelLabel[model] ?? formatRuntimeModelLabel(model);
}

export function resolveModelSelection(
  runtimeDescriptor: RuntimeDescriptorRecord | null | undefined,
  currentValue: string | null | undefined
): string {
  const modelOptions = runtimeDescriptor?.modelOptions ?? [];
  if (modelOptions.length === 0) {
    return "";
  }

  if (currentValue && modelOptions.some((model) => model.id === currentValue)) {
    return currentValue;
  }

  if (
    runtimeDescriptor?.defaultModel &&
    modelOptions.some((model) => model.id === runtimeDescriptor.defaultModel)
  ) {
    return runtimeDescriptor.defaultModel;
  }

  return modelOptions[0]?.id ?? "";
}

export function resolveModelReasoningEffort(
  modelOption: RuntimeModelOption | null,
  currentValue: string | null | undefined
): string {
  if (!modelOption || modelOption.supportedReasoningEfforts.length === 0) {
    return "";
  }

  if (
    currentValue &&
    modelOption.supportedReasoningEfforts.includes(
      currentValue as RuntimeReasoningEffort
    )
  ) {
    return currentValue;
  }

  return modelOption.defaultReasoningEffort ?? "";
}

export function resolveModelServiceTier(
  modelOption: RuntimeModelOption | null,
  currentValue: string | null | undefined
): string {
  if (!modelOption || modelOption.supportedServiceTiers.length === 0) {
    return "";
  }

  if (currentValue === "default" || currentValue === "flex") {
    return DEFAULT_SERVICE_TIER_SELECTION;
  }

  if (
    currentValue &&
    modelOption.supportedServiceTiers.includes(currentValue as RuntimeServiceTier)
  ) {
    return currentValue;
  }

  return modelOption.defaultServiceTier ?? DEFAULT_SERVICE_TIER_SELECTION;
}
