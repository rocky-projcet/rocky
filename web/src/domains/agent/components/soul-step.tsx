import { Check } from "lucide-react";

import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";
import {
  SOUL_IDENTITY_OPTIONS,
  SOUL_RULE_OPTIONS,
  SOUL_STYLE_OPTIONS,
  SOUL_TONE_OPTIONS,
  type SoulAnswers,
} from "../lib/soul-builder";

export type SoulStepPhase = "identity" | "behavior";

export function SoulStep({
  phase,
  answers,
  onChange,
}: {
  phase: SoulStepPhase;
  answers: SoulAnswers;
  onChange: (next: SoulAnswers) => void;
}) {
  function patch(partial: Partial<SoulAnswers>) {
    onChange({ ...answers, ...partial });
  }

  function toggleRule(id: string) {
    const has = answers.rules.includes(id);
    patch({
      rules: has
        ? answers.rules.filter((entry) => entry !== id)
        : [...answers.rules, id],
    });
  }

  if (phase === "identity") {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold tracking-normal text-foreground">
            이 직원은 누구인가요?
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            여기서 정한 정체성과 말투는 직원이 모든 작업에서 유지하는 일관된 색깔이에요.
          </p>
        </div>

        <Section title="이 직원은 어떤 사람인가요?">
          <div className="grid gap-2 sm:grid-cols-2">
            {SOUL_IDENTITY_OPTIONS.map((option) => (
              <Choice
                key={option.id}
                label={option.label}
                active={answers.identity === option.id}
                onClick={() => patch({ identity: option.id })}
              />
            ))}
          </div>
          {answers.identity === "custom" ? (
            <Input
              autoFocus
              placeholder="예: 꼼꼼한 영업 시니어, 10년차 카피라이터"
              value={answers.identityCustom ?? ""}
              onChange={(event) => patch({ identityCustom: event.target.value })}
              className="mt-2"
            />
          ) : null}
        </Section>

        <Section title="어떻게 말하나요?">
          <div className="grid gap-2 sm:grid-cols-2">
            {SOUL_TONE_OPTIONS.map((option) => (
              <Choice
                key={option.id}
                label={option.label}
                description={option.description}
                active={answers.tone === option.id}
                onClick={() => patch({ tone: option.id })}
              />
            ))}
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-normal text-foreground">
          어떻게 일하나요?
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          응답을 어떻게 구성할지, 무엇은 절대 안 하고 무엇은 항상 할지 정해주세요.
        </p>
      </div>

      <Section title="응답을 어떻게 구성하나요?">
        <div className="grid gap-2 sm:grid-cols-2">
          {SOUL_STYLE_OPTIONS.map((option) => (
            <Choice
              key={option.id}
              label={option.label}
              description={option.description}
              active={answers.style === option.id}
              onClick={() => patch({ style: option.id })}
            />
          ))}
        </div>
      </Section>

      <Section title="행동 규칙 (여러 개 선택 가능)">
        <div className="grid gap-2 sm:grid-cols-2">
          {SOUL_RULE_OPTIONS.map((option) => (
            <Choice
              key={option.id}
              label={option.label}
              active={answers.rules.includes(option.id)}
              onClick={() => toggleRule(option.id)}
            />
          ))}
        </div>
      </Section>

      <Section title="시그니처 (선택)" helper="첫 응답에서 항상 하는 행동이 있다면 짧게 적어주세요.">
        <Textarea
          value={answers.signature}
          onChange={(event) => patch({ signature: event.target.value })}
          placeholder="예) 첫 응답엔 한 줄 인사 → 본문은 핵심부터 → 마지막에 다음 행동 한 가지 제안"
          className="min-h-20"
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  helper,
  children,
}: {
  title: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {helper ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{helper}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Choice({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-12 items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
        active
          ? "border-foreground bg-foreground/5 ring-1 ring-foreground/20"
          : "border-border/70 bg-card hover:border-foreground/40 hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          active
            ? "border-foreground bg-foreground text-background"
            : "border-border/80 text-transparent",
        )}
        aria-hidden="true"
      >
        <Check className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
