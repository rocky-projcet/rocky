import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Plug,
  Plus,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Progress } from "@/shared/ui/progress";
import { cn } from "@/shared/lib/utils";
import { agentEngineClient } from "@/shared/lib/api-client";
import type { EcountConnectionSettingsRecord } from "@/shared/lib/agent-engine-client";
import type { MdTemplateInputArtifact } from "@/domains/template/types";
import { ConnectorDialog } from "@/domains/connector/connector-dialog";
import {
  LANGUAGE_OPTIONS,
  type SkillField,
  type SkillFieldOption,
  type SkillStep,
  type SkillTemplate,
} from "../lib/skill-template-catalog";

type AnswerValue =
  | string
  | string[]
  | { primary: string; detail?: string; custom?: string }
  | { from: string; to: string }
  | MdTemplateInputArtifact
  | Array<MdTemplateInputArtifact & { role?: string }>
  | null;

export type SkillWizardAnswers = Record<string, AnswerValue>;

function defaultAnswersFromTemplate(template: SkillTemplate): SkillWizardAnswers {
  const defaults: SkillWizardAnswers = {};
  for (const step of template.steps) {
    for (const field of step.fields) {
      if (field.defaultValue != null) {
        defaults[field.id] = field.defaultValue;
      }
    }
  }
  return defaults;
}

function isStepVisible(step: SkillStep, answers: SkillWizardAnswers): boolean {
  if (!step.showWhen) {
    return true;
  }
  const value = answers[step.showWhen.fieldId];
  return typeof value === "string" && step.showWhen.values.includes(value);
}

export function SkillWizard({
  template,
  initialAnswers,
  onCancel,
  onSubmit,
  finishLabel = "다음",
  onUploadFile,
}: {
  template: SkillTemplate;
  initialAnswers?: SkillWizardAnswers;
  onCancel: () => void;
  onSubmit: (answers: SkillWizardAnswers) => void;
  finishLabel?: string;
  onUploadFile?: (input: {
    fieldId: string;
    file: File;
  }) => Promise<MdTemplateInputArtifact>;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<SkillWizardAnswers>(() => ({
    ...defaultAnswersFromTemplate(template),
    ...(initialAnswers ?? {}),
  }));

  const visibleSteps = template.steps.filter((candidate) => isStepVisible(candidate, answers));
  const totalSteps = visibleSteps.length;
  const safeStepIndex = Math.min(stepIndex, Math.max(totalSteps - 1, 0));
  const step = visibleSteps[safeStepIndex];
  const progress = totalSteps > 0 ? ((safeStepIndex + 1) / totalSteps) * 100 : 0;
  const isLastStep = safeStepIndex === totalSteps - 1;

  function patchAnswer(fieldId: string, next: AnswerValue) {
    setAnswers((current) => ({ ...current, [fieldId]: next }));
  }

  function goNext() {
    if (isLastStep) {
      onSubmit(answers);
      return;
    }
    setStepIndex((current) => current + 1);
  }

  function goBack() {
    if (safeStepIndex === 0) {
      onCancel();
      return;
    }
    setStepIndex((current) => current - 1);
  }

  const stepValid = step.skippable || step.fields.every((field) => isFieldFilled(field, answers[field.id]));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {stepIndex + 1} / {totalSteps}
          </span>
          <span>{template.label}</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      <SkillStepView
        key={step.id}
        step={step}
        answers={answers}
        onChange={patchAnswer}
        onUploadFile={onUploadFile}
      />

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={goBack}>
          <ArrowLeft className="size-4" />
          {stepIndex === 0 ? "처음으로" : "이전"}
        </Button>
        <div className="flex items-center gap-2">
          {step.skippable ? (
            <Button variant="ghost" onClick={goNext}>
              건너뛰기
            </Button>
          ) : null}
          <Button onClick={goNext} disabled={!stepValid}>
            {isLastStep ? finishLabel : "다음"}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function isFieldFilled(field: SkillField, value: AnswerValue): boolean {
  if (field.optional) {
    return true;
  }

  if (field.kind === "single-select" || field.kind === "single-select-with-detail") {
    if (!value) return false;
    if (typeof value === "string") {
      const option = field.options?.find((entry) => entry.id === value);
      return value.length > 0 && option?.disabled !== true;
    }
    if (typeof value === "object" && "primary" in value) {
      const primary = value.primary;
      if (!primary) return false;
      if (primary !== "__custom") {
        const primaryOption = field.options?.find((entry) => entry.id === primary);
        if (primaryOption?.disabled) return false;
      }
      // If user picked an option that has detailOptions but didn't pick a detail, fail
      const opt = field.options?.find((option) => option.id === primary);
      if (opt?.detailOptions && opt.detailOptions.length > 0 && !value.detail) {
        return false;
      }
      return true;
    }
    return false;
  }

  if (field.kind === "multi-select") {
    return Array.isArray(value) && value.length > 0;
  }

  if (field.kind === "language-pair") {
    if (typeof value === "object" && value && "from" in value && "to" in value) {
      return Boolean(value.from && value.to && value.from !== value.to);
    }
    return false;
  }

  if (field.kind === "file-upload") {
    return (typeof value === "string" && value.length > 0) || isInputArtifact(value);
  }

  if (field.kind === "file-with-role") {
    return Array.isArray(value) && value.length > 0;
  }

  if (field.kind === "url-or-file") {
    return (typeof value === "string" && value.length > 0) || isInputArtifact(value);
  }

  if (field.kind === "text") {
    return typeof value === "string" && value.trim().length > 0;
  }

  if (field.kind === "account-connect") {
    return typeof value === "string" && value.length > 0;
  }

  if (field.kind === "erp-integration-select") {
    return typeof value === "string" && value.length > 0;
  }

  if (field.kind === "recipient-address") {
    return typeof value === "string" && value.trim().length > 0;
  }

  return false;
}

function SkillStepView({
  step,
  answers,
  onChange,
  onUploadFile,
}: {
  step: SkillStep;
  answers: SkillWizardAnswers;
  onChange: (fieldId: string, value: AnswerValue) => void;
  onUploadFile?: (input: {
    fieldId: string;
    file: File;
  }) => Promise<MdTemplateInputArtifact>;
}) {
  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-200">
      <h2 className="text-2xl font-semibold tracking-normal text-foreground">
        {step.title}
      </h2>
      {step.helper ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.helper}</p>
      ) : null}

      <div className="mt-6 flex flex-col gap-6">
        {step.fields.map((field) => (
          <SkillFieldView
            key={field.id}
            field={field}
            value={answers[field.id]}
            answers={answers}
            onChange={(next) => onChange(field.id, next)}
            onUploadFile={onUploadFile}
          />
        ))}
      </div>
    </div>
  );
}

function SkillFieldView({
  field,
  value,
  answers,
  onChange,
  onUploadFile,
}: {
  field: SkillField;
  value: AnswerValue;
  answers: SkillWizardAnswers;
  onChange: (value: AnswerValue) => void;
  onUploadFile?: (input: {
    fieldId: string;
    file: File;
  }) => Promise<MdTemplateInputArtifact>;
}) {
  return (
    <FieldShell label={field.label} helper={field.helper}>
      {field.kind === "single-select" ? (
        <SingleSelectField field={field} value={value} onChange={onChange} />
      ) : field.kind === "single-select-with-detail" ? (
        <SingleSelectWithDetail field={field} value={value} onChange={onChange} />
      ) : field.kind === "multi-select" ? (
        <MultiSelectField field={field} value={value} onChange={onChange} />
      ) : field.kind === "language-pair" ? (
        <LanguagePairField value={value} onChange={onChange} />
      ) : field.kind === "file-upload" ? (
        <FileUploadField
          field={field}
          value={value}
          onChange={onChange}
          onUploadFile={onUploadFile}
        />
      ) : field.kind === "file-with-role" ? (
        <FileWithRoleField
          field={field}
          value={value}
          onChange={onChange}
          onUploadFile={onUploadFile}
        />
      ) : field.kind === "url-or-file" ? (
        <UrlOrFileField
          field={field}
          value={value}
          onChange={onChange}
          onUploadFile={onUploadFile}
        />
      ) : field.kind === "text" ? (
        <TextField field={field} value={value} onChange={onChange} />
      ) : field.kind === "account-connect" ? (
        <AccountConnectField value={value} answers={answers} onChange={onChange} />
      ) : field.kind === "erp-integration-select" ? (
        <ErpIntegrationSelectField value={value} onChange={onChange} />
      ) : field.kind === "recipient-address" ? (
        <RecipientAddressField field={field} value={value} onChange={onChange} />
      ) : null}
    </FieldShell>
  );
}

type ChannelConnector = {
  provider:
    | "threads"
    | "instagram"
    | "x"
    | "facebook"
    | "linkedin"
    | "tiktok"
    | "youtube"
    | "naver-blog"
    | "tistory"
    | "brunch"
    | "kakao-channel"
    | "medium"
    | null;
  label: string;
};

function resolveChannelConnector(answers: SkillWizardAnswers): ChannelConnector {
  const channel = answers["channel"];
  let primary: string | null = null;
  let detail: string | null = null;
  if (typeof channel === "string") {
    primary = channel;
  } else if (channel && typeof channel === "object" && "primary" in channel) {
    primary = (channel.primary as string) ?? null;
    detail = (channel.detail as string | undefined) ?? null;
  }

  if (primary === "sns") {
    if (detail === "threads") return { provider: "threads", label: "Threads" };
    if (detail === "instagram" || detail === "instagram-reels") {
      return { provider: "instagram", label: "Instagram" };
    }
    if (detail === "x") return { provider: "x", label: "X (트위터)" };
    if (detail === "facebook") return { provider: "facebook", label: "Facebook" };
    if (detail === "linkedin") return { provider: "linkedin", label: "LinkedIn" };
    if (detail === "tiktok") return { provider: "tiktok", label: "TikTok" };
    if (detail === "youtube-shorts") {
      return { provider: "youtube", label: "YouTube" };
    }
    return { provider: null, label: "SNS" };
  }

  if (primary === "blog") {
    if (detail === "naver") return { provider: "naver-blog", label: "네이버 블로그" };
    if (detail === "tistory") return { provider: "tistory", label: "Tistory" };
    if (detail === "brunch") return { provider: "brunch", label: "브런치" };
    if (detail === "kakao-channel") {
      return { provider: "kakao-channel", label: "카카오 채널" };
    }
    if (detail === "medium") return { provider: "medium", label: "Medium" };
    return { provider: null, label: "블로그" };
  }

  if (primary === "newsletter") return { provider: null, label: "뉴스레터" };
  if (primary === "detail-page") return { provider: null, label: "홈페이지" };
  return { provider: null, label: "발행 계정" };
}

function AccountConnectField({
  value,
  answers,
  onChange,
}: {
  value: AnswerValue;
  answers: SkillWizardAnswers;
  onChange: (value: AnswerValue) => void;
}) {
  const connectedLabel = typeof value === "string" && value.length > 0 ? value : "";
  const [open, setOpen] = useState(false);
  const channel = resolveChannelConnector(answers);
  const supported = channel.provider !== null;

  return (
    <div className="flex flex-col gap-2">
      {connectedLabel ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-foreground/30 bg-foreground/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Check className="size-4 text-foreground" />
            <span className="text-sm font-medium text-foreground">{connectedLabel}</span>
          </div>
          {supported ? (
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
              관리
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              연결 해제
            </Button>
          )}
        </div>
      ) : supported ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted/40"
        >
          <Plug className="size-4" />
          {channel.label} 계정 연결하기
        </button>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">
            {channel.label} 자동 연동은 곧 추가돼요
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            지금은 이 채널 자동 발행이 준비 중입니다. 일단 초안만 받으시고, 발행은 직접 해주세요.
            연동이 추가되면 같은 자리에서 바로 연결할 수 있어요.
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        연결한 세션은 기기에 안전하게 저장되어 다음 작업부터 자동으로 사용됩니다.
      </p>
      {channel.provider ? (
        <ConnectorDialog
          provider={channel.provider}
          providerLabel={channel.label}
          open={open}
          onOpenChange={setOpen}
          onConnected={(connectedLabel) => onChange(connectedLabel)}
        />
      ) : null}
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function ErpIntegrationSelectField({
  value,
  onChange,
}: {
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const selected = typeof value === "string" ? value : "";
  const [settings, setSettings] = useState<EcountConnectionSettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  const selectedRef = useRef(selected);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void agentEngineClient
      .getEcountConnectionSettings()
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        if (!next.configured && selectedRef.current === "ecount") {
          onChangeRef.current(null);
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        setSettings(null);
        setError(caught instanceof Error ? caught.message : "ERP 연동 상태를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const ecountConfigured = settings?.configured === true;
  const ecountLabel = settings?.accountLabel ?? "이카운트 ERP";
  const ecountSelected = selected === "ecount";

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={!ecountConfigured || loading}
        onClick={() => {
          if (ecountConfigured) {
            onChange("ecount");
          }
        }}
        className={cn(
          "flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
          ecountSelected
            ? "border-foreground bg-foreground/5 ring-1 ring-foreground/20"
            : ecountConfigured
              ? "border-border/70 bg-card hover:border-foreground/40 hover:bg-muted/50"
              : "cursor-not-allowed border-border/60 bg-muted/30 opacity-75",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
            ecountSelected
              ? "border-foreground bg-foreground text-background"
              : "border-border/80 text-transparent",
          )}
          aria-hidden="true"
        >
          <Check className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">이카운트 ERP</span>
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {loading
              ? "연동 상태를 확인하는 중입니다."
              : ecountConfigured
                ? [
                    ecountLabel,
                    settings?.zone ? `ZONE ${settings.zone}` : null,
                    settings?.checkedAt ? `마지막 확인 ${formatDateTime(settings.checkedAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "아직 연결된 ECOUNT ERP 연동이 없습니다."}
          </span>
        </span>
        {ecountConfigured ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-3.5" />
            연결됨
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <AlertCircle className="size-3.5" />
            설정 필요
          </span>
        )}
      </button>

      {error ? (
        <p className="text-xs leading-5 text-destructive">{error}</p>
      ) : null}

      {!ecountConfigured && !loading ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
          <p className="min-w-0 flex-1">
            먼저 연동 화면에서 ECOUNT ERP 연결 테스트를 완료한 뒤 스킬에서 선택할 수 있습니다.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            render={<a href="/integrations" />}
          >
            <Plug className="size-4" />
            연동 설정
          </Button>
        </div>
      ) : null}

      <p className="text-xs leading-5 text-muted-foreground">
        스킬에는 연동 참조만 저장합니다. API 키, 비밀번호, 세션 ID는 스킬 내용에 저장하지 않습니다.
      </p>
    </div>
  );
}

function RecipientAddressField({
  field,
  value,
  onChange,
}: {
  field: SkillField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const text = typeof value === "string" ? value : "";
  return (
    <textarea
      value={text}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder ?? "받는 곳을 입력해주세요"}
      rows={3}
      className="w-full rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
    />
  );
}

function FieldShell({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {helper ? <p className="mt-0.5 text-xs text-muted-foreground">{helper}</p> : null}
      </div>
      {children}
    </div>
  );
}

function ChoicePill({
  label,
  description,
  active,
  onClick,
  disabled,
}: {
  label: string;
  description?: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "group flex min-h-12 items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
        disabled
          ? "cursor-not-allowed border-border/60 bg-muted/30 opacity-65"
          : active
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

function SingleSelectField({
  field,
  value,
  onChange,
}: {
  field: SkillField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const selected = typeof value === "string" ? value : "";
  const isCustom = selected === "__custom";
  const customValue =
    typeof value === "object" && value && "primary" in value && value.primary === "__custom"
      ? value.custom ?? ""
      : "";

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(field.options ?? []).map((option) => (
        <ChoicePill
          key={option.id}
          label={option.label}
          description={option.description}
          active={selected === option.id}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
        />
      ))}
      {field.allowCustom ? (
        <div className="sm:col-span-2 flex flex-col gap-2 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3">
          <ChoicePill
            label="직접 입력"
            active={isCustom || (typeof value === "object" && value !== null && "custom" in value)}
            onClick={() =>
              onChange({ primary: "__custom", custom: customValue ?? "" })
            }
          />
          {isCustom || (typeof value === "object" && value !== null && "custom" in value) ? (
            <Input
              autoFocus
              placeholder="원하는 항목을 적어주세요"
              value={customValue}
              onChange={(event) =>
                onChange({ primary: "__custom", custom: event.target.value })
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SingleSelectWithDetail({
  field,
  value,
  onChange,
}: {
  field: SkillField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const current =
    typeof value === "object" && value !== null && "primary" in value
      ? (value as { primary: string; detail?: string; custom?: string })
      : { primary: "", detail: undefined, custom: undefined };

  const primaryOption = field.options?.find((opt) => opt.id === current.primary);
  const detailOptions = primaryOption?.detailOptions;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {(field.options ?? []).map((option) => (
          <ChoicePill
            key={option.id}
            label={option.label}
            description={option.description}
            active={current.primary === option.id}
            disabled={option.disabled}
            onClick={() => onChange({ primary: option.id })}
          />
        ))}
        {field.allowCustom ? (
          <ChoicePill
            label="직접 입력"
            active={current.primary === "__custom"}
            onClick={() => onChange({ primary: "__custom", custom: current.custom ?? "" })}
          />
        ) : null}
      </div>

      {current.primary === "__custom" ? (
        <Input
          autoFocus
          placeholder="어떤 콘텐츠인지 적어주세요"
          value={current.custom ?? ""}
          onChange={(event) =>
            onChange({ primary: "__custom", custom: event.target.value })
          }
        />
      ) : null}

      {detailOptions && detailOptions.length > 0 ? (
        <div className="rounded-2xl border border-border/70 bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {primaryOption?.detailLabel ?? "세부 선택"}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {detailOptions.map((option) => (
              <ChoicePill
                key={option.id}
                label={option.label}
                active={current.detail === option.id}
                disabled={option.disabled}
                onClick={() =>
                  onChange({ primary: current.primary, detail: option.id })
                }
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MultiSelectField({
  field,
  value,
  onChange,
}: {
  field: SkillField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const selected: string[] =
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
      ? (value as string[])
      : [];
  const customEntries = selected.filter((entry) => entry.startsWith("custom:"));
  const [customDraft, setCustomDraft] = useState("");

  function toggle(optionId: string) {
    if (selected.includes(optionId)) {
      onChange(selected.filter((id) => id !== optionId));
    } else {
      onChange([...selected, optionId]);
    }
  }

  function addCustom() {
    const trimmed = customDraft.trim();
    if (!trimmed) return;
    const tag = `custom:${trimmed}`;
    if (selected.includes(tag)) return;
    onChange([...selected, tag]);
    setCustomDraft("");
  }

  function removeCustom(tag: string) {
    onChange(selected.filter((id) => id !== tag));
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {(field.options ?? []).map((option) => (
          <ChoicePill
            key={option.id}
            label={option.label}
            description={option.description}
            active={selected.includes(option.id)}
            disabled={option.disabled}
            onClick={() => toggle(option.id)}
          />
        ))}
      </div>
      {field.allowCustom ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">직접 추가</p>
          <div className="flex items-center gap-2">
            <Input
              placeholder="원하는 항목을 적고 추가"
              value={customDraft}
              onChange={(event) => setCustomDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={addCustom}>
              <Plus className="size-4" />
              추가
            </Button>
          </div>
          {customEntries.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {customEntries.map((tag) => (
                <li
                  key={tag}
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground/10 px-3 py-1 text-xs"
                >
                  {tag.slice("custom:".length)}
                  <button
                    type="button"
                    aria-label="제거"
                    onClick={() => removeCustom(tag)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LanguagePairField({
  value,
  onChange,
}: {
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const current =
    typeof value === "object" && value !== null && "from" in value
      ? (value as { from: string; to: string })
      : { from: "", to: "" };

  function pickFrom(id: string) {
    onChange({ from: id, to: current.to });
  }

  function pickTo(id: string) {
    onChange({ from: current.from, to: id });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <LanguageColumn
        title="원본 언어"
        options={LANGUAGE_OPTIONS}
        selected={current.from}
        onPick={pickFrom}
        disabledId={current.to}
      />
      <LanguageColumn
        title="번역 언어"
        options={LANGUAGE_OPTIONS}
        selected={current.to}
        onPick={pickTo}
        disabledId={current.from}
      />
    </div>
  );
}

function LanguageColumn({
  title,
  options,
  selected,
  onPick,
  disabledId,
}: {
  title: string;
  options: SkillFieldOption[];
  selected: string;
  onPick: (id: string) => void;
  disabledId: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            disabled={option.id === disabledId}
            onClick={() => onPick(option.id)}
            className={cn(
              "rounded-xl border px-3 py-1.5 text-xs transition",
              option.id === selected
                ? "border-foreground bg-foreground text-background"
                : "border-border/60 bg-background hover:border-foreground/40",
              option.id === disabledId ? "opacity-30" : "",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function isInputArtifact(value: AnswerValue | unknown): value is MdTemplateInputArtifact {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as MdTemplateInputArtifact).fileName === "string" &&
    typeof (value as MdTemplateInputArtifact).runtimePath === "string"
  );
}

function answerFileName(value: AnswerValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (isInputArtifact(value)) {
    return value.fileName;
  }
  return "";
}

function FileUploadField({
  field,
  value,
  onChange,
  onUploadFile,
}: {
  field: SkillField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  onUploadFile?: (input: {
    fieldId: string;
    file: File;
  }) => Promise<MdTemplateInputArtifact>;
}) {
  const fileName = answerFileName(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!onUploadFile) {
      onChange(file.name);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      onChange(await onUploadFile({ fieldId: field.id, file }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "파일을 업로드하지 못했습니다.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={field.accept}
        onChange={pick}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-4 text-left transition hover:border-foreground/40 hover:bg-muted/40"
      >
        <Upload className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">
          {uploading ? "업로드 중..." : fileName ? fileName : "파일을 골라주세요"}
        </span>
        {fileName ? (
          <span className="text-xs text-muted-foreground">바꾸기</span>
        ) : null}
      </button>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function FileWithRoleField({
  field,
  value,
  onChange,
  onUploadFile,
}: {
  field: SkillField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  onUploadFile?: (input: {
    fieldId: string;
    file: File;
  }) => Promise<MdTemplateInputArtifact>;
}) {
  const list = Array.isArray(value)
    ? (value as Array<MdTemplateInputArtifact & { role?: string }>)
    : [];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pendingArtifact, setPendingArtifact] =
    useState<(MdTemplateInputArtifact & { role?: string }) | null>(null);
  const [pendingRole, setPendingRole] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    if (!onUploadFile) {
      setPendingArtifact({
        id: file.name,
        runId: "",
        fieldId: field.id,
        fileName: file.name,
        contentType: file.type || null,
        size: file.size,
        runtimePath: "",
        skillPath: null,
        uploadedAt: "",
      });
      return;
    }

    setUploading(true);
    try {
      setPendingArtifact(await onUploadFile({ fieldId: field.id, file }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "파일을 업로드하지 못했습니다.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function commit() {
    if (!pendingArtifact) return;
    onChange([
      ...list,
      { ...pendingArtifact, role: pendingRole.trim() || undefined },
    ]);
    setPendingArtifact(null);
    setPendingRole("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(index: number) {
    onChange(list.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      {list.length > 0 ? (
        <ul className="space-y-2">
          {list.map((entry, index) => (
            <li
              key={`${entry.fileName}-${index}`}
              className="flex items-center justify-between gap-2 rounded-2xl border border-border/70 bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{entry.fileName}</p>
                {entry.role ? (
                  <p className="truncate text-xs text-muted-foreground">{entry.role}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="제거"
                onClick={() => remove(index)}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-3">
        <input ref={inputRef} type="file" className="sr-only" onChange={pickFile} />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" />
            파일 선택
          </Button>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {uploading
              ? "업로드 중..."
              : pendingArtifact?.fileName ?? "파일을 고르고 역할을 적어주세요"}
          </span>
        </div>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        {pendingArtifact ? (
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={pendingRole}
              onChange={(event) => setPendingRole(event.target.value)}
              placeholder="이 파일의 역할 (예: 서명 이미지)"
            />
            <Button type="button" size="sm" onClick={commit}>
              <Plus className="size-4" />
              추가
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UrlOrFileField({
  field,
  value,
  onChange,
  onUploadFile,
}: {
  field: SkillField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  onUploadFile?: (input: {
    fieldId: string;
    file: File;
  }) => Promise<MdTemplateInputArtifact>;
}) {
  const text = typeof value === "string" ? value : "";
  const fileName = isInputArtifact(value) ? value.fileName : "";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!onUploadFile) {
      onChange(file.name);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      onChange(await onUploadFile({ fieldId: field.id, file }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "파일을 업로드하지 못했습니다.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <Input
        type="url"
        value={text.startsWith("http") ? text : ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder="URL 붙여넣기 (예: https://...)"
      />
      <div className="text-center text-xs text-muted-foreground">또는</div>
      <input ref={inputRef} type="file" className="sr-only" onChange={pickFile} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-left text-sm transition hover:border-foreground/40 hover:bg-muted/40"
      >
        <Upload className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {uploading
            ? "업로드 중..."
            : fileName || (text && !text.startsWith("http") ? text : "파일 올리기")}
        </span>
      </button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function TextField({
  field,
  value,
  onChange,
}: {
  field: SkillField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
}) {
  const text = typeof value === "string" ? value : "";
  return (
    <Input
      value={text}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder}
    />
  );
}
