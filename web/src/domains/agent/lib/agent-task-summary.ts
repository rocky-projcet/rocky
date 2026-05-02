import {
  getRockyTaskStatus,
  type RockyTaskStatus,
} from "../../rocky/lib/rocky-task-model.js";
import type { RockyChatRecord } from "../../../shared/lib/agent-engine-client.js";

export type TaskAgentMap = Record<string, string>;

export function isRockyChatForAgent(
  chat: RockyChatRecord,
  agentId: string,
  taskAgentMap: TaskAgentMap = {},
): boolean {
  if (!agentId) {
    return false;
  }

  return (
    taskAgentMap[chat.id] === agentId ||
    chat.worker?.agentId === agentId ||
    chat.orchestration?.agentId === agentId ||
    chat.dispatches.some(
      (dispatch) =>
        dispatch.orchestration?.agentId === agentId ||
        dispatch.skillId === `agent.${agentId}`,
    )
  );
}

export function listRockyChatsForAgent(
  chats: RockyChatRecord[],
  agentId: string,
  taskAgentMap: TaskAgentMap = {},
): RockyChatRecord[] {
  return chats.filter((chat) =>
    isRockyChatForAgent(chat, agentId, taskAgentMap),
  );
}

export function getRockyChatStatusForAgent(
  chat: RockyChatRecord,
): RockyTaskStatus {
  return getRockyTaskStatus(chat);
}

export function countCompletedRockyTasksForAgent(
  chats: RockyChatRecord[],
  agentId: string,
  taskAgentMap: TaskAgentMap = {},
): number {
  return listRockyChatsForAgent(chats, agentId, taskAgentMap).filter(
    (chat) => getRockyChatStatusForAgent(chat) === "completed",
  ).length;
}
