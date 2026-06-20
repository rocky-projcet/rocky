import { AgentEngineClient } from "./agent-engine-client";
import { resolveDesktopApiBaseUrl } from "./desktop-api";

function resolveBaseUrl(): string {
  const desktopBaseUrl = resolveDesktopApiBaseUrl(globalThis);
  if (desktopBaseUrl) {
    return desktopBaseUrl;
  }

  const configured = import.meta.env.VITE_AGENT_ENGINE_BASE_URL;
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : "/api";
}

export const agentEngineClient = new AgentEngineClient(resolveBaseUrl());
