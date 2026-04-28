import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildTemplateSkillFiles,
  createUserTemplateRecord,
  ensureTemplateSkillDefinition,
  markTemplateSkillSyncFailed,
  markTemplateSkillSynced,
  markTemplateSkillSyncing,
} from "@/domains/template/lib/md-template-definitions";
import type { MdTemplateDefinition, MdTemplateDraft } from "@/domains/template/types";
import { ROCKY_CORE_AGENT_SPEC } from "@/domains/rocky/lib/rocky-agent-catalog";
import { agentEngineClient } from "@/shared/lib/api-client";

const STORAGE_KEY = "rocky.md-templates.v1";

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

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

function readUserTemplates(): MdTemplateDefinition[] {
  if (!isBrowserStorageAvailable()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isUserTemplate)
      .map(ensureTemplateSkillDefinition)
      .sort((left, right) =>
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
      );
  } catch {
    return [];
  }
}

function writeUserTemplates(templates: MdTemplateDefinition[]): void {
  if (!isBrowserStorageAvailable()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "스킬 파일을 동기화하지 못했습니다.";
}

export function useMdTemplates() {
  const [userTemplates, setUserTemplates] =
    useState<MdTemplateDefinition[]>(readUserTemplates);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setUserTemplates(readUserTemplates());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const allTemplates = useMemo(() => userTemplates, [userTemplates]);
  const activeTemplates = useMemo(
    () => userTemplates.filter((entry) => !entry.archived),
    [userTemplates],
  );
  const archivedTemplates = useMemo(
    () => userTemplates.filter((entry) => entry.archived === true),
    [userTemplates],
  );

  const replaceTemplate = useCallback((template: MdTemplateDefinition) => {
    setUserTemplates((current) => {
      let replaced = false;
      const nextTemplates = current.map((entry) => {
        if (entry.id !== template.id) {
          return entry;
        }

        replaced = true;
        return template;
      });
      if (!replaced) {
        nextTemplates.unshift(template);
      }
      writeUserTemplates(nextTemplates);
      return nextTemplates;
    });
  }, []);

  const saveTemplate = useCallback(
    async (draft: MdTemplateDraft, editingTemplateId: string | null = null) => {
      const now = new Date().toISOString();
      const existing =
        editingTemplateId && userTemplates.find((template) => template.id === editingTemplateId)
          ? userTemplates.find((template) => template.id === editingTemplateId) ?? null
          : null;
      const nextTemplate = createUserTemplateRecord({
        draft,
        existing,
        id: generateTemplateId(),
        now,
      });
      const nextTemplates = existing
        ? userTemplates.map((template) =>
            template.id === existing.id ? nextTemplate : template
          )
        : [nextTemplate, ...userTemplates];

      writeUserTemplates(nextTemplates);
      setUserTemplates(nextTemplates);

      const syncingTemplate = markTemplateSkillSyncing(nextTemplate);
      replaceTemplate(syncingTemplate);

      try {
        const result = await agentEngineClient.upsertAgentLocalSkill(
          ROCKY_CORE_AGENT_SPEC.id,
          syncingTemplate.skill.id,
          {
            replace: true,
            files: buildTemplateSkillFiles(syncingTemplate),
          }
        );
        const syncedTemplate = markTemplateSkillSynced({
          template: syncingTemplate,
          workspacePath: result.skill.workspacePath,
          now: new Date().toISOString(),
        });
        replaceTemplate(syncedTemplate);
        return syncedTemplate;
      } catch (error) {
        const failedTemplate = markTemplateSkillSyncFailed({
          template: syncingTemplate,
          message: errorMessage(error),
        });
        replaceTemplate(failedTemplate);
        return failedTemplate;
      }
    },
    [replaceTemplate, userTemplates]
  );

  const deleteTemplate = useCallback(
    (templateId: string) => {
      const nextTemplates = userTemplates.filter((template) => template.id !== templateId);
      writeUserTemplates(nextTemplates);
      setUserTemplates(nextTemplates);
    },
    [userTemplates]
  );

  const archiveTemplate = useCallback(
    (templateId: string) => {
      const now = new Date().toISOString();
      const next = userTemplates.map((entry) =>
        entry.id === templateId ? { ...entry, archived: true, updatedAt: now } : entry,
      );
      writeUserTemplates(next);
      setUserTemplates(next);
    },
    [userTemplates],
  );

  const restoreTemplate = useCallback(
    (templateId: string) => {
      const now = new Date().toISOString();
      const next = userTemplates.map((entry) =>
        entry.id === templateId ? { ...entry, archived: false, updatedAt: now } : entry,
      );
      writeUserTemplates(next);
      setUserTemplates(next);
    },
    [userTemplates],
  );

  const updateTemplate = useCallback(
    (
      templateId: string,
      patch: Partial<Pick<MdTemplateDefinition, "title" | "description">>,
    ) => {
      const now = new Date().toISOString();
      const nextTemplates = userTemplates.map((template) =>
        template.id === templateId
          ? { ...template, ...patch, updatedAt: now }
          : template,
      );
      writeUserTemplates(nextTemplates);
      setUserTemplates(nextTemplates);
    },
    [userTemplates],
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
