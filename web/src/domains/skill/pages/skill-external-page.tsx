import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { agentEngineClient } from "@/shared/lib/api-client";
import {
  type ExternalSkillPreviewCheck,
  type ExternalSkillPreviewRecord,
} from "@/shared/lib/agent-engine-client";
import { cn } from "@/shared/lib/utils";

export function SkillExternalPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExternalSkillPreviewRecord | null>(null);

  const previewMutation = useMutation({
    mutationFn: () =>
      agentEngineClient.previewExternalSkill({
        sourceKind: "mcp-market",
        sourceUrl: sourceUrl.trim() || null,
        files: [],
      }),
    onSuccess: (result) => {
      setPreview(result);
      toast.success("외부 스킬 미리보기를 만들었습니다.");
    },
    onError: (error) => {
      const message = readableErrorMessage(error);
      setSelectionError(`미리보기 실패: ${message}`);
      toast.error("미리보기를 만들 수 없습니다.", {
        description: message,
      });
    },
  });

  const mountMutation = useMutation({
    mutationFn: (previewId: string) => agentEngineClient.mountExternalSkill(previewId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["skill-templates"] });
      toast.success("공용 스킬로 장착했습니다.", {
        description: result.skill.title,
      });
      navigate(`/skills/${encodeURIComponent(result.skill.id)}`);
    },
  });

  const failedChecks = useMemo(
    () => preview?.checks.filter((check) => check.status === "failed") ?? [],
    [preview],
  );

  function handlePreview() {
    setSelectionError(null);
    setPreview(null);
    if (!sourceUrl.trim()) {
      setSelectionError("skills.sh URL을 입력하세요.");
      return;
    }
    if (!isSkillsShUrl(sourceUrl)) {
      setSelectionError("https://www.skills.sh/... 형식의 skills.sh URL을 입력하세요.");
      return;
    }
    previewMutation.mutate();
  }

  return (
    <PageContainer>
      <PageHeader
        title="외부 스킬 추가"
        description="skills.sh의 public skill package를 미리보고, 통과한 패키지만 공용 스킬로 장착합니다."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">skills.sh URL</h2>
            </div>

            <div className="mt-4">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="external-source-url"
              >
                Skill URL
              </label>
              <Input
                id="external-source-url"
                className="mt-1"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://www.skills.sh/coreyhaines31/marketingskills/social-content"
              />
            </div>

            {selectionError ? (
              <p className="mt-3 text-sm text-destructive">{selectionError}</p>
            ) : null}

            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                onClick={handlePreview}
                disabled={previewMutation.isPending}
                aria-busy={previewMutation.isPending}
              >
                {previewMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                {previewMutation.isPending ? "미리보기 중" : "장착 미리보기"}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          {preview ? (
            <PreviewPanel
              preview={preview}
              failedChecks={failedChecks}
              mounting={mountMutation.isPending}
              onMount={() => mountMutation.mutate(preview.id)}
            />
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <ShieldCheck className="size-8 text-muted-foreground" />
              <h2 className="mt-3 text-sm font-semibold text-foreground">
                미리보기 대기 중
              </h2>
              <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                패키지 구조, 출처, manifest, 계정정보 주입 가능 여부를 먼저 확인합니다.
              </p>
            </div>
          )}
        </section>
      </div>
    </PageContainer>
  );
}

function isSkillsShUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      (url.hostname === "skills.sh" || url.hostname === "www.skills.sh")
    );
  } catch {
    return false;
  }
}

function readableErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "알 수 없는 오류가 발생했습니다.";
}

function PreviewPanel({
  preview,
  failedChecks,
  mounting,
  onMount,
}: {
  preview: ExternalSkillPreviewRecord;
  failedChecks: ExternalSkillPreviewCheck[];
  mounting: boolean;
  onMount: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{preview.title}</h2>
            <Badge variant={preview.installable ? "secondary" : "destructive"}>
              {preview.installable ? "장착 가능" : "장착 차단"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{preview.skillId}</p>
        </div>
        <Button
          type="button"
          onClick={onMount}
          disabled={!preview.installable || mounting}
        >
          {mounting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          공용 스킬로 장착
        </Button>
      </div>

      <dl className="grid gap-3 rounded-md border bg-background p-3 text-sm sm:grid-cols-2">
        <InfoItem label="Source" value={preview.sourceUrl ?? preview.sourceKind} />
        <InfoItem label="Hash" value={preview.packageHash} />
        <InfoItem label="Files" value={String(preview.fileCount)} />
        <InfoItem label="Preview" value={preview.id} />
      </dl>

      <div>
        <h3 className="text-sm font-semibold text-foreground">Checks</h3>
        <ul className="mt-2 space-y-2">
          {preview.checks.map((check) => (
            <li
              key={check.id}
              className="flex gap-2 rounded-md border bg-background p-3 text-sm"
            >
              <CheckIcon status={check.status} />
              <div>
                <p className="font-medium text-foreground">{check.id}</p>
                <p className="mt-0.5 text-muted-foreground">{check.message}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {preview.capabilities.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-foreground">Possible actions</h3>
          <ul className="mt-2 space-y-2">
            {preview.capabilities.map((capability) => (
              <li
                key={capability.id}
                className="rounded-md border bg-background p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{capability.id}</p>
                  <Badge
                    variant={
                      capability.credentialGateStatus === "blocked"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {capability.credentialGateStatus}
                  </Badge>
                  <Badge variant="outline">{capability.action}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {capability.scriptPath}
                </p>
                {capability.reasons.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-destructive">
                    {capability.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {failedChecks.length > 0 ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          실패한 package check를 해결해야 장착할 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-foreground" title={value}>
        {value}
      </dd>
    </div>
  );
}

function CheckIcon({ status }: { status: ExternalSkillPreviewCheck["status"] }) {
  const className = cn(
    "mt-0.5 size-4 shrink-0",
    status === "passed"
      ? "text-emerald-600"
      : status === "warning"
        ? "text-amber-600"
        : "text-destructive",
  );
  if (status === "passed") return <CheckCircle2 className={className} />;
  if (status === "warning") return <AlertTriangle className={className} />;
  return <XCircle className={className} />;
}
