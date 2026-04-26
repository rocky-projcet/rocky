import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultRockyRunProgressLabel,
  isTerminalRockyRunEvent,
  rockyRunProgressLabelForEvent,
} from "../../web/src/domains/rocky/lib/rocky-run-progress.js";

import type { RuntimeEvent } from "../../web/src/domains/run/types.js";

function event(overrides: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    source: "test",
    type: overrides.type ?? "run.raw",
    runId: overrides.runId ?? "run-1",
    sessionId: overrides.sessionId ?? "session-1",
    runtimeSessionId: overrides.runtimeSessionId ?? null,
    rawType: overrides.rawType ?? overrides.type ?? "unknown",
    occurredAt: overrides.occurredAt ?? "2026-04-26T00:00:00.000Z",
    data: overrides.data ?? {},
    raw: overrides.raw ?? null,
  };
}

test("defaultRockyRunProgressLabel reflects PPT attachment handling", () => {
  assert.equal(
    defaultRockyRunProgressLabel({
      attachmentCount: 1,
      skillId: "rocky.presentation",
      status: "running",
    }),
    "PPT 파일 확인 중"
  );
  assert.equal(
    defaultRockyRunProgressLabel({ skillId: "rocky.core", status: "planned" }),
    "실행 준비 중"
  );
});

test("rockyRunProgressLabelForEvent exposes only the current safe phase", () => {
  assert.equal(
    rockyRunProgressLabelForEvent(event({ type: "run.started" }), {
      skillId: "rocky.presentation",
    }),
    "PPT 요청 처리 중"
  );
  assert.equal(
    rockyRunProgressLabelForEvent(
      event({
        rawType: "item.started",
        raw: { type: "item.started", item: { type: "command_execution" } },
      })
    ),
    "도구 실행 중"
  );
  assert.equal(
    rockyRunProgressLabelForEvent(
      event({
        rawType: "item.completed",
        raw: { type: "item.completed", item: { type: "command_execution" } },
      })
    ),
    "도구 결과 확인 중"
  );
  assert.equal(
    rockyRunProgressLabelForEvent(
      event({ type: "assistant.message.delta", data: { text: "secret draft" } })
    ),
    "답변 작성 중"
  );
});

test("isTerminalRockyRunEvent only treats final run completion events as terminal", () => {
  assert.equal(
    isTerminalRockyRunEvent(event({ type: "run.completed", rawType: "turn.completed" })),
    false
  );
  assert.equal(
    isTerminalRockyRunEvent(event({ type: "run.completed", rawType: "process.close" })),
    true
  );
  assert.equal(
    isTerminalRockyRunEvent(
      event({ type: "run.completed", data: { status: "completed" } })
    ),
    true
  );
});
