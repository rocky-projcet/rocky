import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { agentEngineClient } from "@/shared/lib/api-client";
import { useCreateAgentMutation } from "../hooks";
import { fireMilestone } from "@/domains/onboarding/milestones";
import { SoulStep } from "../components/soul-step";
import {
  buildSoulMarkdown,
  emptySoulAnswers,
  type SoulAnswers,
} from "../lib/soul-builder";
import { AgentAvatar } from "../components/agent-avatar";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { Progress } from "@/shared/ui/progress";
import { PageContainer } from "@/shared/components/page-container";
import { cn } from "@/shared/lib/utils";
import {
  AGENT_AVATAR_COLORS,
  AGENT_EMOJI_PRESETS,
  writeAgentEmoji,
} from "../lib/agent-avatar-store";

const STEPS = ["프로필", "설명", "정체성", "행동 방식"] as const;

export function AgentNewPage() {
  const navigate = useNavigate();
  const createAgentMutation = useCreateAgentMutation();

  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string>(AGENT_EMOJI_PRESETS[0]);
  const [color, setColor] = useState<string>(AGENT_AVATAR_COLORS[0]);
  const [description, setDescription] = useState("");
  const [soulAnswers, setSoulAnswers] = useState<SoulAnswers>(() => emptySoulAnswers());
  const [submitting, setSubmitting] = useState(false);

  const isLastStep = stepIndex === STEPS.length - 1;
  const progress = ((stepIndex + 1) / STEPS.length) * 100;
  const stepValid = stepIndex === 0 ? name.trim().length > 0 : true;

  function goBack() {
    if (stepIndex === 0) {
      navigate("/agents");
      return;
    }
    setStepIndex((current) => current - 1);
  }

  async function goNext() {
    if (!isLastStep) {
      setStepIndex((current) => current + 1);
      return;
    }

    if (submitting) return;
    setSubmitting(true);
    try {
      const soulMarkdown = buildSoulMarkdown(soulAnswers);
      const created = await createAgentMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        soul: soulMarkdown || null,
      });

      writeAgentEmoji(created.id, emoji);

      if (color) {
        try {
          await agentEngineClient.updateAgent(created.id, { color });
        } catch {
          /* color update is optional; ignore */
        }
      }

      const navigateToAgent = () =>
        navigate(`/agents/${encodeURIComponent(created.id)}`, { replace: true });

      const milestoneFired = fireMilestone("first-agent", {
        title: `첫 직원 완성! 🎉 ${created.name}`,
        description: "프로필과 성격은 에이전트 화면에서 언제든 바꿀 수 있어요.",
      });
      if (!milestoneFired) {
        toast.success("에이전트를 만들었습니다.", {
          description: created.name,
        });
      }
      navigateToAgent();
    } catch (error) {
      toast.error("에이전트를 만들지 못했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 pt-10">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {stepIndex + 1} / {STEPS.length}
            </span>
            <span>새 에이전트</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        <div className="animate-in fade-in slide-in-from-right-4 duration-200">
          {stepIndex === 0 ? (
            <ProfileStep
              name={name}
              emoji={emoji}
              color={color}
              onChangeName={setName}
              onChangeEmoji={setEmoji}
              onChangeColor={setColor}
            />
          ) : null}
          {stepIndex === 1 ? (
            <DescriptionStep
              description={description}
              onChange={setDescription}
              name={name}
              emoji={emoji}
              color={color}
            />
          ) : null}
          {stepIndex === 2 ? (
            <SoulStep
              phase="identity"
              answers={soulAnswers}
              onChange={setSoulAnswers}
            />
          ) : null}
          {stepIndex === 3 ? (
            <SoulStep
              phase="behavior"
              answers={soulAnswers}
              onChange={setSoulAnswers}
            />
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="ghost" onClick={goBack} disabled={submitting}>
            <ArrowLeft className="size-4" />
            {stepIndex === 0 ? "취소" : "이전"}
          </Button>
          <Button onClick={goNext} disabled={!stepValid || submitting}>
            {isLastStep ? "에이전트 만들기" : "다음"}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}

function ProfileStep({
  name,
  emoji,
  color,
  onChangeName,
  onChangeEmoji,
  onChangeColor,
}: {
  name: string;
  emoji: string;
  color: string;
  onChangeName: (next: string) => void;
  onChangeEmoji: (next: string) => void;
  onChangeColor: (next: string) => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-normal text-foreground">
        새 에이전트 프로필을 만들어주세요
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        에이전트 이름·이모지·색상을 정해주세요. 나중에 언제든 바꿀 수 있어요.
      </p>

      <div className="mt-8 flex flex-col items-center gap-4">
        <AgentAvatar emoji={emoji} color={color} size="xl" />
        <Input
          value={name}
          onChange={(event) => onChangeName(event.target.value)}
          placeholder="에이전트 이름 (예: 영업 도우미)"
          className="h-11 max-w-sm text-center text-base"
          aria-label="에이전트 이름"
          autoFocus
        />
      </div>

      <div className="mt-8">
        <p className="mb-3 text-sm font-medium text-foreground">캐릭터 이모지</p>
        <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-11">
          {AGENT_EMOJI_PRESETS.map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => onChangeEmoji(option)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-xl border text-2xl leading-none transition",
                option === emoji
                  ? "border-foreground bg-muted"
                  : "border-transparent bg-background hover:border-border hover:bg-muted/60",
              )}
              aria-label={`이모지 ${option}`}
            >
              <span className="block translate-y-px">{option}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-3 text-sm font-medium text-foreground">배경색</p>
        <div className="grid grid-cols-8 gap-2 sm:grid-cols-16">
          {AGENT_AVATAR_COLORS.map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => onChangeColor(option)}
              className={cn(
                "aspect-square rounded-full border-2 transition",
                option === color
                  ? "border-foreground ring-2 ring-offset-2"
                  : "border-transparent hover:scale-110",
              )}
              style={{
                backgroundColor: option,
                ...(option === color
                  ? ({ "--tw-ring-color": `${option}80` } as React.CSSProperties)
                  : {}),
              }}
              aria-label={`색상 ${option}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DescriptionStep({
  description,
  onChange,
  name,
  emoji,
  color,
}: {
  description: string;
  onChange: (next: string) => void;
  name: string;
  emoji: string;
  color: string;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-normal text-foreground">
        이 에이전트는 어떤 일을 하나요?
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        한 줄로 적어두면 다음에 어떤 에이전트인지 헷갈리지 않아요. (선택)
      </p>

      <div className="mt-8 flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4">
        <AgentAvatar emoji={emoji} color={color} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-foreground">{name || "이름 없음"}</p>
          <Textarea
            value={description}
            onChange={(event) => onChange(event.target.value)}
            placeholder="예: 견적서·인보이스 같은 영업 문서를 자동으로 처리하는 도우미입니다."
            className="mt-2 min-h-20"
            aria-label="에이전트 설명"
          />
        </div>
      </div>
    </div>
  );
}
