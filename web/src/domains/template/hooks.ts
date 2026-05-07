import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createUserTemplateRecord,
  ensureTemplateSkillDefinition,
} from "@/domains/template/lib/md-template-definitions";
import type { MdTemplateDefinition, MdTemplateDraft } from "@/domains/template/types";
import { agentEngineClient } from "@/shared/lib/api-client";

const SKILL_TEMPLATES_QUERY_KEY = ["skill-templates"] as const;

function generateTemplateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `template.${crypto.randomUUID()}`;
  }

  return `template.${Date.now().toString(36)}.${Math.random()
    .toString(36)
    .slice(2)}`;
}

function isUserTemplate(value: unknown): value is MdTemplateDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<MdTemplateDefinition>;
  return (
    record.source === "user" &&
    typeof record.id === "string" &&
    (record.category === "document" ||
      record.category === "content" ||
      record.category === "data") &&
    typeof record.title === "string" &&
    typeof record.description === "string" &&
    typeof record.triggerLabel === "string" &&
    Array.isArray(record.requiredInputs) &&
    typeof record.outputFormatLabel === "string" &&
    typeof record.defaultInstructions === "string"
  );
}

function sortTemplates(templates: MdTemplateDefinition[]): MdTemplateDefinition[] {
  return [...templates].sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
  );
}

export function useSkillTemplatesQuery() {
  return useQuery({
    queryKey: SKILL_TEMPLATES_QUERY_KEY,
    queryFn: async () => {
      const records = await agentEngineClient.listSkillTemplates();
      return sortTemplates(
        records.filter(isUserTemplate).map(ensureTemplateSkillDefinition),
      );
    },
    staleTime: 30_000,
  });
}

export function useMdTemplates() {
  const queryClient = useQueryClient();
  const query = useSkillTemplatesQuery();

  const userTemplates = useMemo(() => query.data ?? [], [query.data]);

  const allTemplates = userTemplates;
  const activeTemplates = useMemo(
    () => userTemplates.filter((entry) => !entry.archived),
    [userTemplates],
  );
  const archivedTemplates = useMemo(
    () => userTemplates.filter((entry) => entry.archived === true),
    [userTemplates],
  );

  const upsertMutation = useMutation({
    mutationFn: async (template: MdTemplateDefinition) => {
      const saved = await agentEngineClient.upsertSkillTemplate(template);
      return ensureTemplateSkillDefinition(saved);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<MdTemplateDefinition[]>(
        SKILL_TEMPLATES_QUERY_KEY,
        (current) => {
          const list = current ?? [];
          const next = list.some((entry) => entry.id === saved.id)
            ? list.map((entry) => (entry.id === saved.id ? saved : entry))
            : [saved, ...list];
          return sortTemplates(next);
        },
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      await agentEngineClient.deleteSkillTemplate(templateId);
      return templateId;
    },
    onSuccess: (templateId) => {
      queryClient.setQueryData<MdTemplateDefinition[]>(
        SKILL_TEMPLATES_QUERY_KEY,
        (current) => (current ?? []).filter((entry) => entry.id !== templateId),
      );
    },
  });

  const saveTemplate = useCallback(
    async (draft: MdTemplateDraft, editingTemplateId: string | null = null) => {
      const now = new Date().toISOString();
      const existing = editingTemplateId
        ? userTemplates.find((template) => template.id === editingTemplateId) ?? null
        : null;
      const nextTemplate = createUserTemplateRecord({
        draft,
        existing,
        id: existing?.id ?? generateTemplateId(),
        now,
      });
      return upsertMutation.mutateAsync(nextTemplate);
    },
    [upsertMutation, userTemplates],
  );

  const deleteTemplate = useCallback(
    (templateId: string) => {
      void deleteMutation.mutateAsync(templateId);
    },
    [deleteMutation],
  );

  const archiveTemplate = useCallback(
    (templateId: string) => {
      const target = userTemplates.find((entry) => entry.id === templateId);
      if (!target) return;
      const now = new Date().toISOString();
      void upsertMutation.mutateAsync(
        ensureTemplateSkillDefinition({ ...target, archived: true, updatedAt: now }),
      );
    },
    [upsertMutation, userTemplates],
  );

  const restoreTemplate = useCallback(
    (templateId: string) => {
      const target = userTemplates.find((entry) => entry.id === templateId);
      if (!target) return;
      const now = new Date().toISOString();
      void upsertMutation.mutateAsync(
        ensureTemplateSkillDefinition({ ...target, archived: false, updatedAt: now }),
      );
    },
    [upsertMutation, userTemplates],
  );

  const updateTemplate = useCallback(
    (
      templateId: string,
      patch: Partial<Pick<MdTemplateDefinition, "title" | "description">>,
    ) => {
      const target = userTemplates.find((entry) => entry.id === templateId);
      if (!target) return;
      const now = new Date().toISOString();
      void upsertMutation.mutateAsync(
        ensureTemplateSkillDefinition({ ...target, ...patch, updatedAt: now }),
      );
    },
    [upsertMutation, userTemplates],
  );

  return {
    allTemplates,
    activeTemplates,
    archivedTemplates,
    archiveTemplate,
    restoreTemplate,
    deleteTemplate,
    saveTemplate,
    updateTemplate,
    userTemplates,
  };
}
