import { agentEngineClient } from "@/shared/lib/api-client";
import type { AgentLocalSkillFileInput } from "@/domains/agent/types";
import type { MdTemplateDefinition } from "@/domains/template/types";
import {
  buildTemplateSkillFiles,
  ensureTemplateSkillDefinition,
} from "./md-template-definitions";

export async function resolveTemplateSkillInstallFiles(
  template: MdTemplateDefinition
): Promise<AgentLocalSkillFileInput[]> {
  const normalized = ensureTemplateSkillDefinition(template);

  try {
    const files = await agentEngineClient.getSkillTemplateFiles(normalized.id);
    if (files.length > 0) {
      return files;
    }
  } catch {
    // Local-only templates can still be installed from their generated files.
  }

  return buildTemplateSkillFiles(normalized);
}
