export type RockyChatDomain = "nutrition-md" | "general";

export type RockyMessageRole = "user" | "rocky";

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
  domain: RockyChatDomain;
  workerId: string;
  attachmentIds: string[];
  originalRequest: string;
  skillCandidateIds: string[];
  protectionHints: string[];
  executionStarted: false;
  createdAt: string;
}

export interface RockyMessageRecord {
  id: string;
  chatId: string;
  role: RockyMessageRole;
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
  domain: RockyChatDomain;
  worker: RockyWorkerRecord | null;
  attachments: RockyAttachmentRecord[];
  messages: RockyMessageRecord[];
  skillCandidates: RockySkillCandidateRecord[];
  dispatches: RockyDispatchRecord[];
  executionStarted: false;
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
}
