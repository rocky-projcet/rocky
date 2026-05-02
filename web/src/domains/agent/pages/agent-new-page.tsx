import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";

import { agentEngineClient } from "@/shared/lib/api-client";
import { useMdTemplates } from "@/domains/template/hooks";
import { ensureTemplateSkillDefinition } from "@/domains/template/lib/md-template-definitions";
import { resolveTemplateSkillInstallFiles } from "@/domains/template/lib/runtime-template-files";
import { skillKindTheme } from "@/domains/skill/lib/skill-kind-theme";
import type { MdTemplateDefinition } from "@/domains/template/types";
import { useCreateAgentMutation } from "../hooks";
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

const STEPS = ["프로필", "설명", "스킬"] as const;

export function AgentNewPage() {
  const navigate = useNavigate();
  const createAgentMutation = useCreateAgentMutation();
  const { userTemplates } = useMdTemplates();

  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string>(AGENT_EMOJI_PRESETS[0]);
  const [color, setColor] = useState<string>(AGENT_AVATAR_COLORS[0]);
  const [description, setDescription] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const isLastStep = stepIndex === STEPS.length - 1;
  const progress = ((stepIndex + 1) / STEPS.length) * 100;
  const stepValid = stepIndex === 0 ? name.trim().length > 0 : true;

  function toggleSkill(skillId: string) {
    setSelectedSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId],
    );
  }

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
      const created = await createAgentMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
      });

      writeAgentEmoji(created.id, emoji);

      if (color) {
        try {
          await agentEngineClient.updateAgent(created.id, { color });
        } catch {
          /* color update is optional; ignore */
        }
      }

      let attachedSkillCount = 0;
      const selectedSkills = userTemplates.filter((skill) =>
        selectedSkillIds.includes(skill.id),
      );
      if (selectedSkills.length > 0) {
        try {
          await Promise.all(
            selectedSkills.map(async (skill) => {
              const normalized = ensureTemplateSkillDefinition(skill);
              return agentEngineClient.upsertAgentLocalSkill(
                created.id,
                normalized.skill.id,
                {
                  replace: true,
                  files: await resolveTemplateSkillInstallFiles(normalized),
                },
              );
            }),
          );
          attachedSkillCount = selectedSkills.length;
        } catch (error) {
          toast.warning("에이전트는 만들었지만 일부 스킬을 장착하지 못했습니다.", {
            description: error instanceof Error ? error.message : undefined,
          });
        }
      }

      toast.success("에이전트를 만들었습니다.", {
        description:
          attachedSkillCount > 0
            ? `${created.name}에 스킬 ${attachedSkillCount}개를 장착했습니다.`
            : created.name,
      });
      navigate(`/agents/${encodeURIComponent(created.id)}`, { replace: true });
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
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
            <SkillPickerStep
              skills={userTemplates}
              selectedIds={selectedSkillIds}
              onToggle={toggleSkill}
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

function SkillPickerStep({
  skills,
  selectedIds,
  onToggle,
}: {
  skills: MdTemplateDefinition[];
  selectedIds: string[];
  onToggle: (skillId: string) => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-normal text-foreground">
        어떤 스킬을 장착할까요?
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        에이전트는 장착된 스킬을 필살기처럼 발사해 작업을 처리해요. 0개로 시작해도 나중에 추가할 수 있습니다.
      </p>

      {skills.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
          아직 만든 스킬이 없어요. 일단 에이전트만 만들고 나중에 스킬을 추가하세요.
        </div>
      ) : (
        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {skills.map((skill) => (
            <li key={skill.id}>
              <SkillSlotChoice
                skill={skill}
                selected={selectedIds.includes(skill.id)}
                onToggle={() => onToggle(skill.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        선택된 스킬 {selectedIds.length}개
      </p>
    </div>
  );
}

function SkillSlotChoice({
  skill,
  selected,
  onToggle,
}: {
  skill: MdTemplateDefinition;
  selected: boolean;
  onToggle: () => void;
}) {
  const theme = skillKindTheme(skill);
  const Icon = theme.Icon;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition",
        selected
          ? "border-foreground bg-foreground/5"
          : "border-border/70 bg-card hover:border-foreground/40 hover:bg-muted/40",
      )}
    >
      <div className={cn("flex size-9 items-center justify-center rounded-xl", theme.icon)}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{skill.title}</p>
        <p className="truncate text-xs text-muted-foreground">{skill.triggerLabel}</p>
      </div>
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          selected
            ? "border-foreground bg-foreground text-background"
            : "border-border/80 text-transparent",
        )}
        aria-hidden="true"
      >
        <Check className="size-3.5" />
      </span>
    </button>
  );
}
