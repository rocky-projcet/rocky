import { useEffect, useMemo, useState } from "react";
import { MessageCircleMore, Send, Settings2, Webhook } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";
import type {
  AgentMessengerSlotRecord,
  MessengerProviderKind,
} from "@/shared/lib/agent-engine-client";
import {
  useAgentMessengerSlotsQuery,
  useDeleteMessengerConnectionMutation,
  useUpdateTelegramMessengerConnectionMutation,
} from "../hooks";

function providerIcon(provider: MessengerProviderKind) {
  if (provider === "telegram") {
    return <Send size={16} />;
  }

  if (provider === "kakao") {
    return <MessageCircleMore size={16} />;
  }

  return <Webhook size={16} />;
}

function providerTone(provider: MessengerProviderKind): string {
  if (provider === "telegram") {
    return "border-sky-200 bg-sky-50/70 text-sky-950";
  }

  if (provider === "kakao") {
    return "border-amber-300/60 bg-amber-50/80 text-amber-950";
  }

  if (provider === "slack") {
    return "border-violet-200 bg-violet-50/70 text-violet-950";
  }

  return "border-slate-200 bg-slate-50/70 text-slate-900";
}

function providerAvailabilityLabel(slot: AgentMessengerSlotRecord): string {
  if (slot.connection?.enabled) {
    return "연결됨";
  }

  return slot.descriptor.availability === "available" ? "설정 가능" : "준비 중";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "아직 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AgentMessengerPanel({ agentId }: { agentId: string }) {
  const slotsQuery = useAgentMessengerSlotsQuery(agentId);
  const updateTelegramMutation = useUpdateTelegramMessengerConnectionMutation(agentId);
  const deleteConnectionMutation = useDeleteMessengerConnectionMutation(agentId);
  const slots = slotsQuery.data?.slots ?? [];
  const telegramSlot = slots.find((slot) => slot.provider === "telegram") ?? null;
  const telegramConnection = telegramSlot?.connection ?? null;
  const connectedSlots = slots.filter((slot) => slot.connection?.enabled);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [defaultAckText, setDefaultAckText] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!telegramConnection) {
      setPublicBaseUrl("");
      setBotToken("");
      setDefaultAckText("요청을 접수했습니다. 처리 후 다시 알려드릴게요.");
      setEnabled(true);
      return;
    }

    setPublicBaseUrl(telegramConnection.publicBaseUrl ?? "");
    setBotToken(telegramConnection.botToken ?? "");
    setDefaultAckText(
      telegramConnection.defaultAckText ?? "요청을 접수했습니다. 처리 후 다시 알려드릴게요."
    );
    setEnabled(telegramConnection.enabled);
  }, [
    telegramConnection?.publicBaseUrl,
    telegramConnection?.botToken,
    telegramConnection?.defaultAckText,
    telegramConnection?.enabled,
  ]);

  const panelError = slotsQuery.isError
    ? slotsQuery.error instanceof Error
      ? slotsQuery.error.message
      : "메신저 연동 상태를 불러오지 못했습니다."
    : updateTelegramMutation.isError
      ? updateTelegramMutation.error instanceof Error
        ? updateTelegramMutation.error.message
        : "Telegram 설정 저장에 실패했습니다."
      : deleteConnectionMutation.isError
        ? deleteConnectionMutation.error instanceof Error
          ? deleteConnectionMutation.error.message
          : "메신저 연결 삭제에 실패했습니다."
        : null;

  const summaryCards = useMemo(
    () => [
      {
        label: "활성 채널",
        value:
          connectedSlots.length > 0
            ? connectedSlots.map((slot) => slot.descriptor.label).join(", ")
            : "아직 없음",
      },
      {
        label: "최근 수신",
        value: formatDateTime(telegramSlot?.connection?.lastReceivedAt ?? null),
      },
      {
        label: "최근 전달",
        value: formatDateTime(telegramSlot?.connection?.lastDeliveredAt ?? null),
      },
      {
        label: "즉시 응답",
        value: telegramSlot?.connection?.defaultAckText ?? "기본 문구 사용",
      },
    ],
    [connectedSlots, telegramSlot]
  );

  const detailStats = useMemo(
    () => [
      {
        label: "봇 계정",
        value:
          telegramSlot?.connection?.botUsername
            ? `@${telegramSlot.connection.botUsername}`
            : telegramSlot?.connection?.botUserId ?? "아직 없음",
      },
      {
        label: "최근 동기화",
        value: formatDateTime(telegramSlot?.connection?.lastSyncAt ?? null),
      },
      {
        label: "최근 poll",
        value: formatDateTime(telegramSlot?.connection?.lastPolledAt ?? null),
      },
      {
        label: "마지막 오류",
        value: telegramSlot?.connection?.lastError ?? "없음",
      },
    ],
    [telegramSlot]
  );

  return (
    <>
      <Card className="flex h-full min-h-0 flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">메신저 연동</p>
            <h4 className="mt-2 text-lg font-semibold font-semibold text-foreground">
              대화 채널 연결
            </h4>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              상세 설정은 모달에서 관리하고, 여기에는 현재 연결 상태와 최근 전달 정보만 정리해서
              보여줍니다.
            </p>
          </div>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={14} />
            채널 설정
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 custom-scrollbar overflow-y-auto pr-1">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-2xl bg-muted/70 px-4 py-4">
                <p className="text-xs uppercase text-muted-foreground">{card.label}</p>
                <p className="mt-2 break-words text-sm font-medium text-foreground">
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {slots.map((slot) => (
              <Badge
                key={slot.provider}
                className={cn(
                  "rounded-full border px-2.5 py-1",
                  providerTone(slot.provider),
                  slot.connection?.enabled ? "" : "opacity-80"
                )}
              >
                <span className="mr-1 inline-flex align-middle">{providerIcon(slot.provider)}</span>
                {slot.descriptor.label} · {providerAvailabilityLabel(slot)}
              </Badge>
            ))}
          </div>

          {panelError ? (
            <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
              {panelError}
            </div>
          ) : null}
        </div>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-4xl rounded-4xl p-0">
          <div className="flex max-h-[88vh] flex-col overflow-hidden">
            <DialogHeader className="border-b border-border px-6 py-5">
              <DialogTitle>대화 채널 설정</DialogTitle>
              <DialogDescription>
                현재는 Telegram long polling 연동을 설정할 수 있고, 나머지 채널은 같은 구조로
                이어서 확장됩니다.
              </DialogDescription>
            </DialogHeader>

            <div className="grid min-h-0 gap-5 custom-scrollbar overflow-y-auto px-6 py-5 lg:grid-cols-[1.08fr_0.92fr]">
              <div className="space-y-5">
                <div className="rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Telegram 연결</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        저장하면 `getMe` 확인 후 polling 연결을 시작합니다.
                      </p>
                    </div>
                    <Badge className="rounded-full border border-sky-200 bg-sky-50 text-sky-950">
                      {providerAvailabilityLabel(telegramSlot ?? {
                        provider: "telegram",
                        descriptor: {
                          provider: "telegram",
                          label: "Telegram",
                          subtitle: "",
                          availability: "available",
                          docsUrl: null,
                        },
                        connection: null,
                      })}
                    </Badge>
                  </div>

                  <div className="mt-5 space-y-4">
                    <div className="rounded-2xl border border-border bg-background/80 px-3 py-3">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="telegram-enabled"
                          checked={enabled}
                          onCheckedChange={(next) => setEnabled(next === true)}
                        />
                        <div className="space-y-1">
                          <Label htmlFor="telegram-enabled" className="text-sm font-medium">
                            Telegram 연동 활성화
                          </Label>
                          <p className="text-xs leading-5 text-muted-foreground">
                            이 에이전트가 Telegram 메시지를 받아 세션을 자동 생성하도록 허용합니다.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="telegram-bot-token">Bot Token</Label>
                      <Input
                        id="telegram-bot-token"
                        type="password"
                        value={botToken}
                        onChange={(event) => setBotToken(event.target.value)}
                        placeholder="@BotFather 에서 발급한 토큰"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="telegram-web-url">웹 앱 URL (선택)</Label>
                      <Input
                        id="telegram-web-url"
                        value={publicBaseUrl}
                        onChange={(event) => setPublicBaseUrl(event.target.value)}
                        placeholder="http://localhost:4173"
                      />
                      <p className="text-xs leading-5 text-muted-foreground">
                        완료 메시지에 세션 링크를 함께 보내고 싶을 때만 입력합니다.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="telegram-ack-text">즉시 응답 문구</Label>
                      <Textarea
                        id="telegram-ack-text"
                        value={defaultAckText}
                        onChange={(event) => setDefaultAckText(event.target.value)}
                        className="min-h-24"
                        placeholder="요청을 접수했습니다. 처리 후 다시 알려드릴게요."
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      void updateTelegramMutation.mutateAsync({
                        enabled,
                        publicBaseUrl,
                        botToken,
                        defaultAckText,
                      })
                    }
                    disabled={updateTelegramMutation.isPending || deleteConnectionMutation.isPending}
                  >
                    저장
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void deleteConnectionMutation.mutateAsync("telegram")}
                    disabled={!telegramSlot?.connection || updateTelegramMutation.isPending}
                  >
                    연결 제거
                  </Button>
                  {telegramSlot?.descriptor.docsUrl ? (
                    <a
                      href={telegramSlot.descriptor.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(buttonVariants({ variant: "ghost" }))}
                    >
                      공식 문서
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    상태 요약
                  </p>
                  <div className="mt-4 grid gap-3">
                    {detailStats.map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3"
                      >
                        <p className="text-xs uppercase text-muted-foreground">{stat.label}</p>
                        <p className="mt-2 break-words text-sm font-medium text-foreground">
                          {stat.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    운영 메모
                  </p>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                    <p>단일 작업 결과 전달 대상 채팅 ID는 각 작업 편집 화면에서 따로 지정합니다.</p>
                    <p>로컬 개발에서는 공개 URL 없이도 polling만으로 Telegram 연결을 시험할 수 있습니다.</p>
                    <p>동일한 사용자와 채널 조합은 같은 세션으로 이어지고, 완료 메시지에 웹 세션 링크를 붙일 수 있습니다.</p>
                  </div>
                </div>

                <div className="rounded-3xl border border-border/70 bg-card/70 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    준비 중 채널
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {slots
                      .filter((slot) => slot.provider !== "telegram")
                      .map((slot) => (
                        <Badge
                          key={slot.provider}
                          className={cn("rounded-full border px-2.5 py-1", providerTone(slot.provider))}
                        >
                          <span className="mr-1 inline-flex align-middle">
                            {providerIcon(slot.provider)}
                          </span>
                          {slot.descriptor.label} · {providerAvailabilityLabel(slot)}
                        </Badge>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
