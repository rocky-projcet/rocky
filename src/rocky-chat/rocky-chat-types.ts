import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
} from "../runtime/runtime-types.js";

export type RockyChatDomain = "general";

export type RockyMessageRole = "user" | "rocky";

export type RockyRoutingIntent =
  | "conversation"
  | "clarification";

export type RockyOrchestrationStatus =
  | "planned"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface RockyOrchestrationRecord {
  id: string;
  status: RockyOrchestrationStatus;
  agentId: string | null;
  sessionId: string | null;
  runId: string | null;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

export interface RockyAttachmentInput {
  name: string;
  contentType?: string | null;
  size?: number | null;
  contentBase64?: string | null;
  publicUrl?: string | null;
}

export interface RockyAttachmentRecord {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
  workspacePath: string | null;
  publicUrl?: string | null;
  addedAt: string;
}

export interface RockySkillCandidateRecord {
  id: string;
  title: string;
  description: string;
  trigger: string;
  confidence: number;
  sourceMessageId: string;
  status: "candidate";
  createdAt: string;
}

export interface RockyUsedSkillRecord {
  id: string;
  displayName: string;
}

export type RockyAbilityIcon = "message-square" | "presentation";

export interface RockyAbilityCardRecord {
  id: string;
  skillId: string;
  title: string;
  description: string;
  icon: RockyAbilityIcon;
  examples: string[];
  matchedSkillIds: string[];
  installedSkillIds: string[];
  installed: boolean;
  sortOrder: number;
}

export interface RockyWorkerRecord {
  id: string;
  skillId: string;
  domain: RockyChatDomain;
  displayName: string;
  agentId: string | null;
  reason: string;
  status: "ready";
  createdAt: string;
  updatedAt: string;
}

export interface RockyDispatchRecord {
  id: string;
  chatId: string;
  messageId: string;
  skillId: string;
  intent: RockyRoutingIntent;
  domain: RockyChatDomain;
  workerId: string;
  attachmentIds: string[];
  originalRequest: string;
  skillCandidateIds: string[];
  protectionHints: string[];
  orchestration: RockyOrchestrationRecord | null;
  executionStarted: boolean;
  createdAt: string;
}

export interface RockyMessageRecord {
  id: string;
  chatId: string;
  role: RockyMessageRole;
  intent: RockyRoutingIntent;
  text: string;
  attachmentIds: string[];
  domain: RockyChatDomain;
  workerId: string | null;
  skillCandidateIds: string[];
  usedSkills: RockyUsedSkillRecord[];
  dispatchId: string | null;
  createdAt: string;
}

export interface RockyChatMessagePageRecord {
  messages: RockyMessageRecord[];
  limit: number;
  totalCount: number;
  hasPrevious: boolean;
  nextBefore: string | null;
}

export interface RockyChatMessagePageInput {
  limit?: number | null;
  before?: string | null;
}

export interface RockyChatRecord {
  id: string;
  title: string;
  intent: RockyRoutingIntent;
  domain: RockyChatDomain;
  worker: RockyWorkerRecord | null;
  attachments: RockyAttachmentRecord[];
  messages: RockyMessageRecord[];
  skillCandidates: RockySkillCandidateRecord[];
  dispatches: RockyDispatchRecord[];
  orchestration: RockyOrchestrationRecord | null;
  executionStarted: boolean;
  createdAt: string;
  updatedAt: string;
  messagePage?: RockyChatMessagePageRecord;
}

export interface RockyCoreSettingsRecord {
  defaultRuntimeKind: RuntimeKind;
  defaultModel: string | null;
  defaultReasoningEffort: RuntimeReasoningEffort | null;
  defaultServiceTier: RuntimeServiceTier | null;
  defaultOllamaLaunchTarget: RuntimeOllamaLaunchTarget | null;
  updatedAt: string | null;
}

export interface RockyCoreSettingsUpdateInput {
  defaultRuntimeKind?: RuntimeKind;
  defaultModel?: string | null;
  defaultReasoningEffort?: RuntimeReasoningEffort | null;
  defaultServiceTier?: RuntimeServiceTier | null;
  defaultOllamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
}

export interface RockyCoreSkillRecord {
  id: string;
  version: string;
  displayName: string;
  description: string;
  workspacePath: string | null;
  matchedSkillIds: string[];
  installedSkillIds: string[];
  installed: boolean;
  synchronized: boolean;
}

export interface RockyCoreSessionHealthRecord {
  homeChatCount: number;
  chatsWithDispatches: number;
  chatsWithoutSessionIds: number;
  chatsWithMissingSessions: number;
  existingSessionCount: number;
  runningSessionCount: number;
  danglingSessionIds: string[];
}

export interface RockyCoreManagementRecord {
  agent: {
    id: string;
    name: string;
    description: string;
    workspaceRoot: string;
    runtimeHome: string;
    defaultRuntime: RuntimeKind;
    lifecycle: "active" | "archived";
    updatedAt: string;
  } | null;
  settings: RockyCoreSettingsRecord;
  skills: RockyCoreSkillRecord[];
  sessionHealth: RockyCoreSessionHealthRecord;
}

export interface RockyChatCreateInput {
  message: string;
  attachments?: RockyAttachmentInput[];
  agentId?: string | null;
  skillId?: string | null;
}

export interface RockyChatMessageInput {
  message: string;
  attachments?: RockyAttachmentInput[];
}

export type RockyTemplateCategory = "document" | "content" | "data";

export type RockyTemplateInterviewStepId =
  | "intent"
  | "inputs"
  | "output"
  | "rules"
  | "review";

export interface RockyTemplateDraft {
  category: RockyTemplateCategory;
  title: string;
  description: string;
  triggerLabel: string;
  requiredInputs: string[];
  outputFormatLabel: string;
  defaultInstructions: string;
}

export interface RockyTemplateInterviewAnswer {
  stepId: RockyTemplateInterviewStepId;
  answer: string;
}

export interface RockyTemplateInterviewTurnInput {
  stepId: RockyTemplateInterviewStepId;
  answer: string;
  answers?: RockyTemplateInterviewAnswer[];
  draft?: RockyTemplateDraft | null;
}

export interface RockyTemplateInterviewAgentRecord {
  status: RockyOrchestrationStatus;
  sessionId: string | null;
  runId: string | null;
  output: string | null;
  error: string | null;
}

export interface RockyTemplateInterviewTurnResult {
  summary: string;
  nextStepId: RockyTemplateInterviewStepId;
  draft: RockyTemplateDraft | null;
  source: "agent" | "fallback";
  agent: RockyTemplateInterviewAgentRecord | null;
}

export interface RockyChatServiceLike {
  listAbilityCards(): Promise<RockyAbilityCardRecord[]>;
  startAbilityGuide(abilityId: string): Promise<RockyChatRecord>;
  processTemplateInterviewTurn(
    input: RockyTemplateInterviewTurnInput
  ): Promise<RockyTemplateInterviewTurnResult>;
  createChat(input: RockyChatCreateInput): Promise<RockyChatRecord>;
  getChat(
    chatId: string,
    page?: RockyChatMessagePageInput
  ): Promise<RockyChatRecord>;
  getChatMessages(
    chatId: string,
    page?: RockyChatMessagePageInput
  ): Promise<RockyChatMessagePageRecord>;
  listChats(): Promise<RockyChatRecord[]>;
  getCoreManagement(): Promise<RockyCoreManagementRecord>;
  updateCoreSettings(
    input: RockyCoreSettingsUpdateInput
  ): Promise<RockyCoreManagementRecord>;
  syncCoreSkills(): Promise<RockyCoreManagementRecord>;
  addMessage(
    chatId: string,
    input: RockyChatMessageInput
  ): Promise<RockyChatRecord>;
  cancelChat(chatId: string): Promise<RockyChatRecord>;
  deleteChat(chatId: string): Promise<void>;
}
