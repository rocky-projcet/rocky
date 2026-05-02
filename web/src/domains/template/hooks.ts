import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createUserTemplateRecord,
  ensureTemplateSkillDefinition,
} from "@/domains/template/lib/md-template-definitions";
import type { MdTemplateDefinition, MdTemplateDraft } from "@/domains/template/types";
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

function sortTemplates(templates: MdTemplateDefinition[]): MdTemplateDefinition[] {
  return [...templates].sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
  );
}

async function persistTemplateToRuntime(template: MdTemplateDefinition): Promise<void> {
  await agentEngineClient.upsertSkillTemplate(template);
}

function persistTemplateToRuntimeInBackground(template: MdTemplateDefinition): void {
  void persistTemplateToRuntime(template).catch(() => {
    // Keep local state usable even if the backend is temporarily unavailable.
  });
}

function deleteTemplateFromRuntimeInBackground(templateId: string): void {
  void agentEngineClient.deleteSkillTemplate(templateId).catch(() => {
    // Local deletion remains authoritative for this browser until the next sync.
  });
}

export function useMdTemplates() {
  const [userTemplates, setUserTemplates] =
    useState<MdTemplateDefinition[]>(readUserTemplates);

  useEffect(() => {
    let cancelled = false;

    async function loadRuntimeTemplates(): Promise<void> {
      const localTemplates = readUserTemplates();
      try {
        const runtimeTemplates = (await agentEngineClient.listSkillTemplates())
          .filter(isUserTemplate)
          .map(ensureTemplateSkillDefinition);

        if (cancelled) {
          return;
        }

        if (runtimeTemplates.length > 0) {
          const sorted = sortTemplates(runtimeTemplates);
          writeUserTemplates(sorted);
          setUserTemplates(sorted);
          return;
        }

        if (localTemplates.length > 0) {
          await Promise.all(
            localTemplates.map((template) =>
              agentEngineClient.upsertSkillTemplate(ensureTemplateSkillDefinition(template))
            )
          );
        }
      } catch {
        // Fall back to localStorage when the backend is unavailable during dev.
      }
    }

    void loadRuntimeTemplates();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setUserTemplates(readUserTemplates());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorage);
    };
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
      const saved = await agentEngineClient.upsertSkillTemplate(nextTemplate);
      const normalizedSaved = ensureTemplateSkillDefinition(saved);
      const savedTemplates = existing
        ? userTemplates.map((template) =>
            template.id === existing.id ? normalizedSaved : template
          )
        : [normalizedSaved, ...userTemplates];

      writeUserTemplates(savedTemplates);
      setUserTemplates(savedTemplates);
      return normalizedSaved;
    },
    [userTemplates]
  );

  const deleteTemplate = useCallback(
    (templateId: string) => {
      const nextTemplates = userTemplates.filter((template) => template.id !== templateId);
      writeUserTemplates(nextTemplates);
      setUserTemplates(nextTemplates);
      deleteTemplateFromRuntimeInBackground(templateId);
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
      const archived = next.find((entry) => entry.id === templateId);
      if (archived) {
        persistTemplateToRuntimeInBackground(archived);
      }
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
      const restored = next.find((entry) => entry.id === templateId);
      if (restored) {
        persistTemplateToRuntimeInBackground(restored);
      }
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
          ? ensureTemplateSkillDefinition({ ...template, ...patch, updatedAt: now })
          : template,
      );
      writeUserTemplates(nextTemplates);
      setUserTemplates(nextTemplates);
      const updated = nextTemplates.find((entry) => entry.id === templateId);
      if (updated) {
        persistTemplateToRuntimeInBackground(updated);
      }
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
