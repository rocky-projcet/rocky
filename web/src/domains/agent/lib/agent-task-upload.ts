import {
  fileToBase64,
  type RockyAttachmentInput,
  type RockyChatCreateInput,
} from "../../../shared/lib/agent-engine-client.js";

export type AgentTaskFileEncoder = (file: File) => Promise<string>;

export async function buildRockyAttachmentInputs(
  files: File[],
  encodeFile: AgentTaskFileEncoder = fileToBase64
): Promise<RockyAttachmentInput[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      contentType: file.type || null,
      size: file.size,
      contentBase64: await encodeFile(file),
    }))
  );
}

export async function buildAgentTaskChatInput({
  agentId,
  message,
  skillId,
  files,
  encodeFile,
}: {
  agentId: string;
  message: string;
  skillId: string | null;
  files: File[];
  encodeFile?: AgentTaskFileEncoder;
}): Promise<RockyChatCreateInput> {
  const attachments = await buildRockyAttachmentInputs(files, encodeFile);

  return {
    message,
    agentId,
    skillId,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}
