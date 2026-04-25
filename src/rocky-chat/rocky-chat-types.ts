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
}

export interface RockyAttachmentRecord {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
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
  dispatchId: string | null;
  createdAt: string;
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
}

export interface RockyChatCreateInput {
  message: string;
  attachments?: RockyAttachmentInput[];
}

export interface RockyChatMessageInput {
  message: string;
  attachments?: RockyAttachmentInput[];
}

export interface RockyChatServiceLike {
  createChat(input: RockyChatCreateInput): Promise<RockyChatRecord>;
  getChat(chatId: string): Promise<RockyChatRecord>;
  listChats(): Promise<RockyChatRecord[]>;
  addMessage(
    chatId: string,
    input: RockyChatMessageInput
  ): Promise<RockyChatRecord>;
  deleteChat(chatId: string): Promise<void>;
}
