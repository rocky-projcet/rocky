import { useMemo } from "react";

import {
  useAgentLocalSkillsQuery,
  useDeleteAgentLocalSkillMutation,
  useUpsertAgentLocalSkillMutation,
} from "../hooks";
import {
  ensureTemplateSkillDefinition,
} from "@/domains/template/lib/md-template-definitions";
import { resolveTemplateSkillInstallFiles } from "@/domains/template/lib/runtime-template-files";
import type { MdTemplateDefinition } from "@/domains/template/types";

export function useAgentSkills(agentId: string | undefined) {
  const skillsQuery = useAgentLocalSkillsQuery(agentId);
  const upsertSkillMutation = useUpsertAgentLocalSkillMutation(agentId);
  const deleteSkillMutation = useDeleteAgentLocalSkillMutation(agentId);
  const skillRecords = skillsQuery.data ?? [];
  const skillIds = useMemo(
    () => skillRecords.map((skill) => skill.id),
    [skillRecords],
  );

  async function attachSkill(template: MdTemplateDefinition) {
    const normalized = ensureTemplateSkillDefinition(template);
    await upsertSkillMutation.mutateAsync({
      skillId: normalized.skill.id,
      replace: true,
      files: await resolveTemplateSkillInstallFiles(normalized),
    });
  }

  async function detachSkill(skillId: string) {
    await deleteSkillMutation.mutateAsync(skillId);
  }

  return {
    attachSkill,
    detachSkill,
    isLoading: skillsQuery.isLoading,
    isMutating: upsertSkillMutation.isPending || deleteSkillMutation.isPending,
    skillIds,
    skillRecords,
  };
}

export function useAgentSkillCount(agentId: string | undefined): number {
  const skillsQuery = useAgentLocalSkillsQuery(agentId);
  return skillsQuery.data?.length ?? 0;
}
