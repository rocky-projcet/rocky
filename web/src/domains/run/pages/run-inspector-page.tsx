import {
  type ReactNode,
  startTransition,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";

import { ArtifactPreviewCard } from "../components/artifact-preview-card";
import { PageState } from "@/shared/components/page-state";
import type {
  AgentRunRecord,
  RunArtifactRecord,
  RuntimeEvent,
  RuntimeRunResult,
} from "../types";
import { agentEngineClient } from "@/shared/lib/api-client";
import {
  useRunArtifactsQuery,
  useRunEventsQuery,
  useRunQuery,
  useRunResultQuery,
} from "../hooks";
import { RunEventsSource } from "../lib/run-events-source";
import {
  formatRuntimeModelLabel,
  reasoningEffortLabel,
  serviceTierLabel,
} from "@/domains/codex/lib/runtime-model-options";
import { formatElapsedDuration } from "@/domains/session/lib/transcript-display";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";

type StreamState = "idle" | "connecting" | "open" | "closed" | "disconnected";

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "실행 중";
  }

  return new Date(value).toLocaleString();
}

function statusTone(status: string): string {
  if (status === "completed") {
    return "bg-secondary text-secondary-foreground";
  }

  if (status === "failed") {
    return "bg-destructive/15 text-destructive";
  }

  if (status === "cancelled") {
    return "bg-secondary text-secondary-foreground";
  }

  return "bg-secondary text-secondary-foreground";
}

function formatReasoningEffort(value: string | null): string {
  if (!value) {
    return "기본값";
  }

  return reasoningEffortLabel[value as keyof typeof reasoningEffortLabel] ?? value;
}

function formatServiceTier(value: string | null): string {
  if (!value) {
    return "기본값";
  }

  return serviceTierLabel[value as keyof typeof serviceTierLabel] ?? value;
}

function eventTone(event: RuntimeEvent): string {
  if (event.type === "run.error") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }

  if (event.type === "run.warning" || event.type === "run.stderr") {
    return "border-border bg-secondary text-secondary-foreground";
  }

  if (event.type === "assistant.message.completed") {
    return "border-border bg-secondary text-secondary-foreground";
  }

  return "border-border bg-card text-foreground";
}

function previewText(value: string | null | undefined, limit = 140): string {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 1)}…`;
}

function inspectorPreviewText(value: string | null | undefined, limit = 180): string {
  if (!value) {
    return "";
  }

  const withoutCodeFences = value
    .replace(/```([a-zA-Z0-9_-]+)?/g, " ")
    .replace(/`/g, " ");

  return previewText(withoutCodeFences, limit);
}

function eventSummary(event: RuntimeEvent): string {
  if (event.type === "session.bound") {
    return `런타임 세션 ${String(event.data.runtimeSessionId ?? event.runtimeSessionId ?? "").trim()} 바인딩됨`;
  }

  if (event.type === "run.started") {
    return "실행 시작됨";
  }

  if (event.type === "assistant.message.delta") {
    return previewText(String(event.data.text ?? ""), 80) || "어시스턴트 스트리밍 델타";
  }

  if (event.type === "assistant.message.completed") {
    return previewText(String(event.data.text ?? ""), 160) || "어시스턴트 메시지 완료";
  }

  if (event.type === "run.warning" || event.type === "run.error") {
    return String(event.data.message ?? event.type);
  }

  if (event.type === "run.stderr" || event.type === "run.stdout") {
    return previewText(String(event.data.line ?? ""), 160) || event.type;
  }

  if (event.type === "run.completed") {
    const status = event.data.status;
    if (typeof status === "string") {
      return `실행 완료, 상태: ${status}`;
    }

    return "턴 완료";
  }

  return event.rawType || event.type;
}

function eventFullText(event: RuntimeEvent): string | null {
  if (
    event.type === "assistant.message.delta" ||
    event.type === "assistant.message.completed"
  ) {
    const text = event.data.text;
    return typeof text === "string" && text.trim() ? text : null;
  }

  if (event.type === "run.warning" || event.type === "run.error") {
    const message = event.data.message;
    return typeof message === "string" && message.trim() ? message : null;
  }

  if (event.type === "run.stderr" || event.type === "run.stdout") {
    const line = event.data.line;
    return typeof line === "string" && line.trim() ? line : null;
  }

  return null;
}

function isTerminalEvent(event: RuntimeEvent): boolean {
  return (
    event.type === "run.completed" &&
    (event.rawType === "process.close" || typeof event.data.status === "string")
  );
}

function isRunLive(run: AgentRunRecord | null, result: RuntimeRunResult | null): boolean {
  return run?.status === "running" || result?.status === "running";
}

function warningMessage(warning: Record<string, unknown>): string {
  if (typeof warning.message === "string" && warning.message.trim()) {
    return warning.message;
  }

  return JSON.stringify(warning);
}

function JsonPreview(props: {
  title: string;
  value: unknown;
}) {
  return (
    <Card className="gap-0 bg-muted/90 p-5">
      <p className="text-xs uppercase  text-muted-foreground">{props.title}</p>
      <pre className="mt-4 custom-scrollbar overflow-x-auto rounded-2xl bg-foreground p-4 text-xs leading-6 text-primary-foreground">
        {JSON.stringify(props.value, null, 2)}
      </pre>
    </Card>
  );
}

function InspectorCard(props: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-0 bg-muted/90 p-5">
      <p className="text-xs uppercase  text-muted-foreground">{props.title}</p>
      <div className="mt-4">{props.children}</div>
    </Card>
  );
}

export function RunInspectorPage() {
  const { runId } = useParams();
  const runQuery = useRunQuery(runId);
  const resultQuery = useRunResultQuery(runId);
  const artifactsQuery = useRunArtifactsQuery(runId);
  const sourceRef = useRef<RunEventsSource | null>(null);
  const refetchRun = runQuery.refetch;
  const refetchResult = resultQuery.refetch;
  const refetchArtifacts = artifactsQuery.refetch;

  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [showTimelineWarnings, setShowTimelineWarnings] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [expandedEventKeys, setExpandedEventKeys] = useState<Record<string, boolean>>({});
  const [clockNow, setClockNow] = useState(() => Date.now());

  const run = runQuery.data ?? null;
  const result = resultQuery.data ?? null;
  const live = isRunLive(run, result);
  const eventsQuery = useRunEventsQuery(runId, Boolean(runId && run && result && !live));

  useEffect(() => {
    setEvents([]);
    setStreamState("idle");
    setTimelineError(null);
    setShowTimelineWarnings(false);
    setShowWarnings(false);
    setExpandedEventKeys({});
    sourceRef.current?.close();
    sourceRef.current = null;
  }, [runId]);

  useEffect(() => {
    if (!eventsQuery.data || live) {
      return;
    }

    setEvents(eventsQuery.data);
    setStreamState("closed");
  }, [eventsQuery.data, live]);

  useEffect(() => {
    if (!eventsQuery.isError) {
      return;
    }

    setTimelineError(
      eventsQuery.error instanceof Error
        ? eventsQuery.error.message
        : "정규화된 이벤트 타임라인을 불러올 수 없습니다."
    );
  }, [eventsQuery.error, eventsQuery.isError]);

  useEffect(() => {
    if (!runId || !run || !result || !live) {
      return;
    }

    setTimelineError(null);
    setStreamState("connecting");
    setEvents([]);

    const source = new RunEventsSource(runId, {
      onOpen: () => setStreamState("open"),
      onError: (message) => {
        setStreamState("disconnected");
        setTimelineError(message ?? "실시간 실행 스트림이 끊어졌습니다.");
      },
      onEvent: (event) => {
        setEvents((current) => [...current, event]);

        if (!isTerminalEvent(event)) {
          return;
        }

        source.close();
        if (sourceRef.current === source) {
          sourceRef.current = null;
        }

        setStreamState("closed");
        void (async () => {
          try {
            const [history] = await Promise.all([
              agentEngineClient.getRunEvents(runId),
              refetchRun(),
              refetchResult(),
              refetchArtifacts(),
            ]);

            startTransition(() => {
              setEvents(history);
            });
          } catch (error) {
            setTimelineError(
              error instanceof Error
                ? error.message
                : "최종 이벤트 타임라인을 새로고침할 수 없습니다."
            );
          }
        })();
      },
    });

    sourceRef.current = source;

    return () => {
      if (sourceRef.current === source) {
        sourceRef.current = null;
      }
      source.close();
    };
  }, [
    live,
    result,
    refetchArtifacts,
    refetchResult,
    refetchRun,
    run,
    runId,
  ]);

  useEffect(() => {
    if (!live || !run?.startedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [live, run?.startedAt]);

  if (!runId) {
    return (
      <PageState
        eyebrow="누락"
        title="실행 ID가 없습니다"
        description="세션 트랜스크립트, 실시간 상태 카드에서 실행 기록을 열거나, /runs/:runId 직접 링크를 사용하세요."
      />
    );
  }

  if (runQuery.isLoading || resultQuery.isLoading) {
    return (
      <PageState
        eyebrow="로딩"
        title="대화 상세를 불러오는 중입니다"
        description="실행 메타데이터와 최종 결과를 대화 상세 화면에 불러오고 있습니다."
      />
    );
  }

  if (runQuery.isError || resultQuery.isError) {
    const error = runQuery.error ?? resultQuery.error;
    return (
      <PageState
        eyebrow="오류"
        title="실행을 불러올 수 없습니다"
        description={error instanceof Error ? error.message : "실행 요청에 실패했습니다."}
      />
    );
  }

  if (!run || !result) {
    return (
      <PageState
        eyebrow="누락"
        title="실행을 찾을 수 없습니다"
        description="대화 상세 화면에는 실제 실행 기록과 최종 결과가 필요합니다."
      />
    );
  }

  const artifacts = artifactsQuery.data ?? [];
  const eventListLoading = eventsQuery.isLoading && !live && events.length === 0;
  const promptPreview = inspectorPreviewText(run.prompt, 220);
  const summaryPreview = inspectorPreviewText(run.summary, 220);
  const hiddenWarningCount = events.filter((event) => event.type === "run.warning").length;
  const visibleEvents = showTimelineWarnings
    ? events
    : events.filter((event) => event.type !== "run.warning");
  const elapsedLabel = formatElapsedDuration(
    run.startedAt,
    result.endedAt ?? run.endedAt,
    clockNow
  );

  return (
    <section className="space-y-5">
      <Card className="gap-0 bg-foreground p-6 text-primary-foreground">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase  text-primary-foreground/60">{run.id}</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-normal font-semibold leading-tight">
              대화 상세
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-primary-foreground/80">
              메시지 흐름, 경고, stderr, 아티팩트를 한 화면에서 확인합니다.
              세션 트랜스크립트, 실시간 상태 카드, 또는 직접 링크에서 열 수 있습니다.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              className="border-white/10 bg-white/10 text-primary-foreground hover:bg-white/16 hover:text-primary-foreground"
              onClick={() => setShowRawJson((current) => !current)}
            >
              {showRawJson ? "원시 JSON 숨기기" : "원시 JSON 보기"}
            </Button>
            <Link
              to={`/agents/${run.agentId}/sessions/${run.sessionId}`}
              className="inline-flex rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold !text-foreground no-underline visited:no-underline visited:!text-foreground shadow-md transition hover:bg-secondary"
            >
              세션 워크스페이스로 돌아가기
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 xl:grid-cols-2">
          <div className="rounded-2xl border border-card/10 bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">프롬프트 미리보기</div>
            <div className="mt-2 text-sm leading-7 text-primary-foreground">
              {promptPreview || "프롬프트 미리보기가 없습니다."}
            </div>
          </div>
          <div className="rounded-2xl border border-card/10 bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">결과 미리보기</div>
            <div className="mt-2 text-sm leading-7 text-primary-foreground">
              {summaryPreview || "아직 결과 요약이 없습니다."}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          <div className="rounded-2xl bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">상태</div>
            <div className="mt-2">
              <Badge
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold",
                  statusTone(result.status),
                )}
              >
                {live ? <span className="h-2 w-2 animate-pulse rounded-full bg-current/80" /> : null}
                {result.status}
              </Badge>
            </div>
          </div>
          <div className="rounded-2xl bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">모델</div>
            <div className="mt-2 text-sm leading-6">
              {formatRuntimeModelLabel(run.model)}
            </div>
          </div>
          <div className="rounded-2xl bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">추론 수준</div>
            <div className="mt-2 text-sm leading-6">
              {formatReasoningEffort(run.reasoningEffort)}
            </div>
          </div>
          <div className="rounded-2xl bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">응답 속도</div>
            <div className="mt-2 text-sm leading-6">
              {formatServiceTier(run.serviceTier)}
            </div>
          </div>
          <div className="rounded-2xl bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">경과</div>
            <div className="mt-2 text-sm leading-6">{elapsedLabel ?? "n/a"}</div>
          </div>
          <div className="rounded-2xl bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">시작</div>
            <div className="mt-2 text-sm leading-6">{formatTimestamp(run.startedAt)}</div>
          </div>
          <div className="rounded-2xl bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">종료</div>
            <div className="mt-2 text-sm leading-6">{formatTimestamp(run.endedAt)}</div>
          </div>
          <div className="rounded-2xl bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">이벤트</div>
            <div className="mt-2 text-sm font-semibold font-medium">{events.length}</div>
          </div>
          <div className="rounded-2xl bg-card/6 px-4 py-4">
            <div className="text-xs uppercase -wide text-primary-foreground/60">아티팩트</div>
            <div className="mt-2 text-sm font-semibold font-medium">{artifacts.length}</div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-inspector">
        <InspectorCard title="이벤트 타임라인">
          {hiddenWarningCount > 0 ? (
            <div className="mb-3 rounded-2xl border border-border bg-card px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-7 text-muted-foreground">
                  기본적으로 타임라인에서 경고 이벤트 {hiddenWarningCount}개가 숨겨져 있습니다.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowTimelineWarnings((current) => !current)}
                >
                  {showTimelineWarnings ? "경고 이벤트 숨기기" : "경고 이벤트 보기"}
                </Button>
              </div>
            </div>
          ) : null}

          {timelineError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm leading-7 text-destructive">
              {timelineError}
            </div>
          ) : null}

          {eventListLoading ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-sm text-muted-foreground">
              정규화된 이벤트 타임라인 로딩 중입니다.
            </div>
          ) : null}

          {!eventListLoading && visibleEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-sm text-muted-foreground">
              {events.length > 0 && hiddenWarningCount > 0 && !showTimelineWarnings
                ? "경고 이벤트만 기록되었으며 현재 숨겨져 있습니다."
                : live
                ? "실시간 실행 이벤트 수신 대기 중입니다."
                : "이 실행에 대해 정규화된 이벤트가 기록되지 않았습니다."}
            </div>
          ) : null}

          {visibleEvents.length > 0 ? (
            <div className="space-y-3">
              {visibleEvents.map((event, index) => (
                (() => {
                  const eventKey = `${event.occurredAt}-${event.type}-${index}`;
                  const summary = eventSummary(event);
                  const fullText = eventFullText(event);
                  const canExpand =
                    typeof fullText === "string" &&
                    fullText.trim().length > 0 &&
                    summary.includes("…");
                  const expanded = Boolean(expandedEventKeys[eventKey]);

                  return (
                    <article
                      key={eventKey}
                      className={cn(
                        "rounded-2xl border px-4 py-4",
                        eventTone(event),
                      )}
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="rounded-full bg-foreground/5 px-2 py-1 text-xs font-semibold uppercase -wide">
                              {event.type}
                            </Badge>
                            <span className="text-xs uppercase  opacity-60">
                              {event.rawType}
                            </span>
                          </div>
                          {canExpand && expanded ? (
                            <pre className="mt-3 custom-scrollbar overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm leading-7">
                              {fullText}
                            </pre>
                          ) : (
                            <p className="mt-3 text-sm leading-7">{summary}</p>
                          )}
                          {canExpand ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setExpandedEventKeys((current) => ({
                                  ...current,
                                  [eventKey]: !current[eventKey],
                                }))
                              }
                              className="mt-3"
                            >
                              {expanded ? "이벤트 텍스트 접기" : "전체 이벤트 텍스트 보기"}
                            </Button>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-xs uppercase  opacity-60">
                          {formatTimestamp(event.occurredAt)}
                        </div>
                      </div>
                    </article>
                  );
                })()
              ))}
            </div>
          ) : null}
        </InspectorCard>

        <div className="space-y-5">
          <InspectorCard title="결과 페이로드">
            <dl className="space-y-4 text-sm text-muted-foreground">
              <div>
                <dt className="font-semibold text-foreground">런타임 세션</dt>
                <dd className="mt-1 break-all leading-6">
                  {result.runtimeSessionId ?? "바인딩 안 됨"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">모델</dt>
                <dd className="mt-1 break-all leading-6">
                  {formatRuntimeModelLabel(run.model)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">추론 수준</dt>
                <dd className="mt-1 break-all leading-6">
                  {formatReasoningEffort(run.reasoningEffort)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">응답 속도</dt>
                <dd className="mt-1 break-all leading-6">
                  {formatServiceTier(run.serviceTier)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">종료 코드</dt>
                <dd className="mt-1">{result.exitCode === null ? "n/a" : result.exitCode}</dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">시그널</dt>
                <dd className="mt-1">{result.signal ?? "없음"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-foreground">마지막 메시지</dt>
                <dd className="mt-1 whitespace-pre-wrap leading-6">
                  {result.lastMessage ?? "캡처된 어시스턴트 메시지가 없습니다."}
                </dd>
              </div>
            </dl>
          </InspectorCard>

          <InspectorCard title="경고">
            {result.warnings.length === 0 ? (
              <p className="text-sm text-muted-foreground">기록된 경고가 없습니다.</p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border bg-card px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-7 text-muted-foreground">
                      경고 {result.warnings.length}개가 캡처되었습니다.
                      재연결 및 전송 경고가 많을 수 있어 기본적으로 숨겨져 있습니다.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowWarnings((current) => !current)}
                    >
                      {showWarnings ? "경고 숨기기" : "경고 보기"}
                    </Button>
                  </div>
                </div>

                {showWarnings ? (
                  <div className="space-y-3">
                    {result.warnings.map((warning, index) => (
                      <div
                        key={`${warningMessage(warning)}-${index}`}
                        className="rounded-2xl border border-border bg-secondary px-4 py-3 text-sm leading-6 text-secondary-foreground"
                      >
                        {warningMessage(warning)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </InspectorCard>

          <InspectorCard title="stderr">
            {result.stderr.length === 0 ? (
              <p className="text-sm text-muted-foreground">캡처된 stderr 출력이 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {result.stderr.map((line, index) => (
                  <pre
                    key={`${line}-${index}`}
                    className="custom-scrollbar overflow-x-auto rounded-2xl bg-foreground px-4 py-3 text-xs leading-6 text-primary-foreground"
                  >
                    {line}
                  </pre>
                ))}
              </div>
            )}
          </InspectorCard>

          <InspectorCard title="아티팩트">
            {artifactsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">아티팩트 메타데이터 로딩 중입니다.</p>
            ) : null}
            {artifactsQuery.isError ? (
              <p className="text-sm text-destructive">
                {artifactsQuery.error instanceof Error
                  ? artifactsQuery.error.message
                  : "아티팩트 메타데이터를 불러올 수 없습니다."}
              </p>
            ) : null}
            {!artifactsQuery.isLoading && !artifactsQuery.isError && artifacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">This run did not publish artifacts.</p>
            ) : null}
            {artifacts.length > 0 ? (
              <div className="space-y-3">
                {artifacts.map((artifact: RunArtifactRecord) => (
                  <ArtifactPreviewCard
                    key={artifact.role}
                    artifact={artifact}
                    runId={run.id}
                    showInspectLink={false}
                  />
                ))}
              </div>
            ) : null}
          </InspectorCard>
        </div>
      </div>

      {showRawJson ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <JsonPreview title="Run record JSON" value={run} />
          <JsonPreview title="Run result JSON" value={result} />
          <JsonPreview title="Normalized events JSON" value={events} />
        </div>
      ) : null}
    </section>
  );
}
