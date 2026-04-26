import type { RuntimeEvent } from "../../run/types.js";

type RockyRunProgressContext = {
  attachmentCount?: number;
  skillId?: string | null;
  status?: string | null;
};

function isPresentationSkill(skillId: string | null | undefined): boolean {
  return skillId === "rocky.presentation";
}

function rawRecord(event: RuntimeEvent): Record<string, unknown> | null {
  return event.raw && typeof event.raw === "object" && !Array.isArray(event.raw)
    ? (event.raw as Record<string, unknown>)
    : null;
}

function rawItemType(event: RuntimeEvent): string | null {
  const raw = rawRecord(event);
  const item = raw?.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const type = (item as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

export function defaultRockyRunProgressLabel(
  context: RockyRunProgressContext = {}
): string {
  if (context.status === "planned") {
    return "실행 준비 중";
  }

  if (isPresentationSkill(context.skillId)) {
    return context.attachmentCount && context.attachmentCount > 0
      ? "PPT 파일 확인 중"
      : "PPT 능력 준비 중";
  }

  return "요청 내용 확인 중";
}

export function rockyRunProgressLabelForEvent(
  event: RuntimeEvent,
  context: RockyRunProgressContext = {}
): string | null {
  if (event.type === "session.bound") {
    return "작업 세션 연결 중";
  }

  if (event.type === "run.started") {
    return isPresentationSkill(context.skillId)
      ? "PPT 요청 처리 중"
      : "요청 처리 시작 중";
  }

  if (event.type === "assistant.message.delta") {
    return "답변 작성 중";
  }

  if (event.type === "assistant.message.completed") {
    return "결과 정리 중";
  }

  if (event.type === "run.stdout") {
    return "도구 결과 확인 중";
  }

  if (event.type === "run.stderr" || event.type === "run.warning") {
    return "실행 상태 확인 중";
  }

  if (event.type === "run.error") {
    return "오류 상태 확인 중";
  }

  if (event.type === "run.completed") {
    return "마무리 중";
  }

  if (event.type === "run.raw") {
    const itemType = rawItemType(event);
    if (event.rawType === "item.started" && itemType === "command_execution") {
      return "도구 실행 중";
    }
    if (event.rawType === "item.completed" && itemType === "command_execution") {
      return "도구 결과 확인 중";
    }
    if (event.rawType === "process.start") {
      return "실행 시작 중";
    }
    if (event.rawType === "turn.started") {
      return isPresentationSkill(context.skillId)
        ? "PPT 요청 처리 중"
        : "요청 처리 시작 중";
    }
  }

  return null;
}

export function isTerminalRockyRunEvent(event: RuntimeEvent): boolean {
  return (
    event.type === "run.completed" &&
    (event.rawType === "process.close" || typeof event.data.status === "string")
  );
}
