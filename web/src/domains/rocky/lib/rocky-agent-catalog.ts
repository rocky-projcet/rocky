import type { AgentRecord } from "@/domains/agent/types";

export interface RockyInternalAgentSpec {
  id: string;
  name: string;
  role: string;
  description: string;
}

export const ROCKY_INTERNAL_AGENT_SPECS: RockyInternalAgentSpec[] = [
  {
    id: "rocky-core",
    name: "Rocky Core",
    role: "메인 오케스트레이터",
    description: "홈 화면에서 사용자의 메인 에이전트로 동작하며 대화와 요청 해석을 맡습니다.",
  },
  {
    id: "rocky-general-task",
    name: "자료 정리 담당",
    role: "범용 위임 에이전트",
    description: "요약, 정리, 분석, 작성 같은 일반 작업을 Rocky 대신 실행합니다.",
  },
  {
    id: "rocky-visual-report",
    name: "시각화 리포트 담당",
    role: "차트·리포트 에이전트",
    description: "지표 요약, 그래프 생성, Markdown 리포트 정리를 Rocky 대신 실행합니다.",
  },
  {
    id: "rocky-nutrition-md",
    name: "영양제 MD 담당",
    role: "도메인 위임 에이전트",
    description: "영양제 MD 관련 자료 작업과 보호 항목이 있는 분석 요청을 처리합니다.",
  },
];

const rockyInternalAgentIds = new Set(ROCKY_INTERNAL_AGENT_SPECS.map((agent) => agent.id));

export function isRockyInternalAgentId(agentId: string): boolean {
  return rockyInternalAgentIds.has(agentId);
}

export function isRockyInternalAgent(agent: Pick<AgentRecord, "id">): boolean {
  return isRockyInternalAgentId(agent.id);
}

export function filterUserManagedAgents<T extends Pick<AgentRecord, "id">>(agents: T[]): T[] {
  return agents.filter((agent) => !isRockyInternalAgent(agent));
}

export function getRockyInternalAgentSpec(
  agentId: string
): RockyInternalAgentSpec | undefined {
  return ROCKY_INTERNAL_AGENT_SPECS.find((agent) => agent.id === agentId);
}
