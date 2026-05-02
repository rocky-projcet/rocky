export type MdTemplateCategory = "document" | "content" | "data";

export type MdTemplateSource = "builtin" | "user";

export type MdTemplateSkillSyncStatus = "local" | "syncing" | "synced" | "failed";

export interface MdTemplateInputArtifact {
  id: string;
  runId: string;
  fieldId: string;
  fileName: string;
  contentType: string | null;
  size: number | null;
  runtimePath: string;
  skillPath?: string | null;
  uploadedAt: string;
}

export interface MdTemplateOpenAiSkill {
  id: string;
  displayName: string;
  description: string;
  invocation: string;
  skillMarkdown: string;
  openAiYaml: string;
  syncStatus: MdTemplateSkillSyncStatus;
  workspacePath: string | null;
  lastSyncedAt?: string;
  lastSyncError?: string;
}

export interface MdTemplateDefinition {
  id: string;
  source: MdTemplateSource;
  category: MdTemplateCategory;
  title: string;
  description: string;
  triggerLabel: string;
  requiredInputs: string[];
  inputFiles?: string[];
  inputArtifacts?: MdTemplateInputArtifact[];
  sourceRunId?: string | null;
  outputFormatLabel: string;
  outputFiles?: string[];
  defaultInstructions: string;
  skill: MdTemplateOpenAiSkill;
  sortOrder: number;
  /** When true, the skill is in the archive (soft-deleted). */
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface MdTemplateDraft {
  category: MdTemplateCategory;
  title: string;
  description: string;
  triggerLabel: string;
  requiredInputs: string[];
  inputFiles?: string[];
  inputArtifacts?: MdTemplateInputArtifact[];
  sourceRunId?: string | null;
  outputFormatLabel: string;
  defaultInstructions: string;
}

export type MdTemplateWizardStepId =
  | "intent"
  | "inputs"
  | "output"
  | "rules"
  | "review";

export interface MdTemplateWizardStep {
  id: MdTemplateWizardStepId;
  title: string;
  prompt: string;
  helper: string;
}

export interface MdTemplateWizardAnalysis {
  draft: MdTemplateDraft;
  summary: string;
  nextStepId: MdTemplateWizardStepId;
}

export interface MdTemplateCategoryOption {
  id: MdTemplateCategory;
  title: string;
  description: string;
  triggerLabel: string;
  requiredInputs: string[];
  outputFormatLabel: string;
  defaultInstructions: string;
}
