import type { AgentRecord } from "@/domains/agent/types";

export interface RockyCoreAgentSpec {
  id: string;
  name: string;
  role: string;
  description: string;
}

export const ROCKY_CORE_AGENT_SPEC: RockyCoreAgentSpec = {
  id: "rocky-core",
  name: "Rocky Core",
  role: "홈 대화 실행 주체",
  description:
    "홈 화면에서 사용자의 대화와 작업 요청을 처리하는 Rocky 전용 코어 에이전트입니다.",
};

export function isRockyCoreAgentId(agentId: string): boolean {
  return agentId === ROCKY_CORE_AGENT_SPEC.id;
}

export function isRockyCoreAgent(agent: Pick<AgentRecord, "id">): boolean {
  return isRockyCoreAgentId(agent.id);
}

export function filterUserManagedAgents<T extends Pick<AgentRecord, "id">>(
  agents: T[]
): T[] {
  return agents.filter((agent) => !isRockyCoreAgent(agent));
}
