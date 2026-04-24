import * as React from "react";
import { Link } from "react-router-dom";
import {
  AudioLines,
  BarChart3,
  Download,
  ExternalLink,
  Eye,
  FileText,
  ImageIcon,
  Video,
} from "lucide-react";

import type { AgentSessionArtifactManifestEntry } from "@/domains/session/types";
import type { RunArtifactRecord } from "../types";
import { agentEngineClient } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { ChartArtifactPreview } from "./chart-artifact-preview";
import { PptxArtifactPreview } from "./pptx-artifact-preview";

type ArtifactLike = AgentSessionArtifactManifestEntry | RunArtifactRecord;

const ACTION_LINK_BASE =
  "inline-flex no-underline visited:no-underline";
const ACTION_ICON_BUTTON_BASE =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-foreground no-underline transition hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50";

function formatBytes(size: number | null): string {
  if (size === null) {
    return "크기 정보 없음";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactLabel(artifact: ArtifactLike): string {
  if (artifact.presentation === "image") {
    return "이미지";
  }

  if (artifact.presentation === "chart") {
    return "차트";
  }

  return "파일";
}

function artifactSupportText(artifact: ArtifactLike): string {
  if (artifact.presentation === "chart") {
    return "안전 차트 미리보기 (다운로드 대체 가능)";
  }

  return artifact.previewable
    ? "인라인 미리보기 가능"
    : "다운로드 전용 아티팩트";
}

function baseContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isPowerPointPreviewSupported(artifact: ArtifactLike): boolean {
  const contentType = baseContentType(artifact.contentType);
  const name = artifact.name.toLowerCase();

  return (
    contentType === "application/vnd.ms-powerpoint" ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    name.endsWith(".ppt") ||
    name.endsWith(".pptx")
  );
}

function ArtifactActionIconButton(props: {
  label: string;
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const trigger = props.href ? (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      aria-label={props.label}
      className={ACTION_ICON_BUTTON_BASE}
    >
      {props.children}
    </a>
  ) : (
    <button
      type="button"
      aria-label={props.label}
      onClick={props.onClick}
      className={ACTION_ICON_BUTTON_BASE}
    >
      {props.children}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function UnsupportedArtifactPreviewMessage(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[18rem] items-center justify-center rounded-2xl border border-border bg-card px-6 text-center text-body-md text-muted-foreground">
      {props.children}
    </div>
  );
}

function InlineVideoArtifactPreview(props: {
  previewHref: string | null;
}) {
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [props.previewHref]);

  if (!props.previewHref) {
    return (
      <UnsupportedArtifactPreviewMessage>
        이 영상 파일은 인라인 미리보기를 지원하지 않습니다.
      </UnsupportedArtifactPreviewMessage>
    );
  }

  if (failed) {
    return (
      <UnsupportedArtifactPreviewMessage>
        브라우저가 이 영상 코덱을 재생하지 못했습니다. H.264(`avc1`) 또는 WebM 형식으로 다시 저장한 뒤 확인할 수 있습니다.
      </UnsupportedArtifactPreviewMessage>
    );
  }

  return (
    <div className="flex h-full min-h-[18rem] items-center justify-center rounded-2xl border border-border bg-black p-4">
      <video
        key={props.previewHref}
        controls
        playsInline
        preload="metadata"
        className="max-h-full w-full rounded-xl"
        src={props.previewHref}
        onError={() => setFailed(true)}
      >
        브라우저가 영상 미리보기를 지원하지 않습니다.
      </video>
    </div>
  );
}

function HtmlArtifactPreview(props: {
  downloadHref: string;
  name: string;
}) {
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ready"; html: string }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  React.useEffect(() => {
    const controller = new AbortController();

    setState({ kind: "loading" });
    fetch(props.downloadHref, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        setState({ kind: "ready", html: await response.text() });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "HTML 미리보기를 불러오지 못했습니다.",
        });
      });

    return () => controller.abort();
  }, [props.downloadHref]);

  if (state.kind === "loading") {
    return (
      <UnsupportedArtifactPreviewMessage>
        HTML 미리보기를 불러오는 중입니다.
      </UnsupportedArtifactPreviewMessage>
    );
  }

  if (state.kind === "error") {
    return (
      <UnsupportedArtifactPreviewMessage>
        HTML 미리보기를 불러오지 못했습니다. {state.message}
      </UnsupportedArtifactPreviewMessage>
    );
  }

  return (
    <div className="h-full min-h-[28rem] overflow-hidden rounded-2xl border border-border bg-white">
      <iframe
        title={`${props.name} HTML 미리보기`}
        srcDoc={state.html}
        sandbox=""
        className="h-full min-h-[28rem] w-full border-0"
      />
    </div>
  );
}

function CompactArtifactName(props: { name: string }) {
  const [labelElement, setLabelElement] = React.useState<HTMLSpanElement | null>(null);
  const [isTruncated, setIsTruncated] = React.useState(false);

  React.useEffect(() => {
    if (!labelElement) {
      setIsTruncated(false);
      return;
    }

    const measure = () => {
      setIsTruncated(labelElement.scrollWidth > labelElement.clientWidth + 1);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(labelElement);
    return () => observer.disconnect();
  }, [labelElement, props.name]);

  const label = (
    <span
      ref={setLabelElement}
      className="block truncate text-body-md font-semibold text-foreground"
    >
      {props.name}
    </span>
  );

  if (!isTruncated) {
    return label;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`전체 파일명 보기: ${props.name}`}
            className="block min-w-0 max-w-full rounded-md text-left outline-hidden transition focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {label}
          </button>
        }
      />
      <TooltipContent
        side="top"
        align="start"
        sideOffset={8}
        className="max-w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-background/10 bg-foreground/98 px-3 py-2 text-body-sm leading-5 text-background shadow-2xl whitespace-normal break-all"
      >
        {props.name}
      </TooltipContent>
    </Tooltip>
  );
}

export function ArtifactPreviewCard(props: {
  artifact: ArtifactLike;
  runId?: string | null;
  showInspectLink?: boolean;
  variant?: "default" | "compact";
  className?: string;
  onPreview?: () => boolean | Promise<boolean>;
}) {
  const showInspectLink = props.showInspectLink ?? true;
  const variant = props.variant ?? "default";
  const previewHref =
    props.artifact.previewUrl === null
      ? null
      : agentEngineClient.resolveApiPath(props.artifact.previewUrl);
  const downloadHref = agentEngineClient.resolveApiPath(props.artifact.downloadUrl);
  const contentType = baseContentType(props.artifact.contentType);
  const supportsHtmlPreview =
    props.artifact.presentation === "file" && contentType === "text/html";
  const supportsPowerPointPreview =
    props.artifact.presentation === "file" &&
    isPowerPointPreviewSupported(props.artifact);
  const supportsDialogPreview =
    props.artifact.presentation === "chart" ||
    previewHref !== null ||
    supportsHtmlPreview ||
    supportsPowerPointPreview;
  const [previewOpen, setPreviewOpen] = React.useState(false);

  const handlePreview = React.useCallback(() => {
    void (async () => {
      if (props.onPreview) {
        const handled = await props.onPreview();
        if (handled) {
          return;
        }
      }

      if (supportsDialogPreview) {
        setPreviewOpen(true);
      }
    })();
  }, [props.onPreview, supportsDialogPreview]);

  if (variant === "compact") {
    const supportsCompactPreview = Boolean(props.onPreview) || supportsDialogPreview;

    return (
      <>
        <article
          className={cn(
            "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 shadow-sm",
            props.className,
          )}
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            {props.artifact.presentation === "image" ? (
              <ImageIcon size={16} />
            ) : props.artifact.presentation === "chart" ? (
              <BarChart3 size={16} />
            ) : (
              <FileText size={16} />
            )}
          </div>

          <div className="min-w-0">
            <CompactArtifactName name={props.artifact.name} />
            <div className="mt-0.5 text-label-md text-muted-foreground">
              {formatBytes(props.artifact.size)}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {supportsCompactPreview ? (
              <ArtifactActionIconButton label="미리보기" onClick={handlePreview}>
                <Eye size={14} />
              </ArtifactActionIconButton>
            ) : null}
            {previewHref ? (
              <ArtifactActionIconButton label="새 탭에서 열기" href={previewHref}>
                <ExternalLink size={14} />
              </ArtifactActionIconButton>
            ) : null}
            <ArtifactActionIconButton label="다운로드" href={downloadHref}>
              <Download size={14} />
            </ArtifactActionIconButton>
          </div>
        </article>

        {supportsDialogPreview ? (
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className="flex h-[min(88vh,56rem)] max-h-[88vh] w-[min(96vw,72rem)] max-w-[72rem] flex-col gap-0 overflow-hidden border-border bg-background p-0">
              <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-label-md uppercase text-muted-foreground">
                      <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                        {props.artifact.presentation === "image" ? (
                          <ImageIcon size={16} />
                        ) : props.artifact.presentation === "chart" ? (
                          <BarChart3 size={16} />
                        ) : contentType.startsWith("audio/") ? (
                          <AudioLines size={16} />
                        ) : contentType.startsWith("video/") ? (
                          <Video size={16} />
                        ) : (
                          <FileText size={16} />
                        )}
                      </span>
                      <span>{artifactLabel(props.artifact)}</span>
                      <span>{formatBytes(props.artifact.size)}</span>
                    </div>
                    <DialogTitle className="mt-3 min-w-0 text-xl font-semibold text-foreground">
                      {props.artifact.name}
                    </DialogTitle>
                    <DialogDescription className="mt-1 break-all text-body-sm leading-6">
                      {props.artifact.role} · {props.artifact.contentType}
                    </DialogDescription>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {previewHref ? (
                      <ArtifactActionIconButton label="새 탭에서 열기" href={previewHref}>
                        <ExternalLink size={14} />
                      </ArtifactActionIconButton>
                    ) : null}
                    <ArtifactActionIconButton label="다운로드" href={downloadHref}>
                      <Download size={14} />
                    </ArtifactActionIconButton>
                  </div>
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 custom-scrollbar overflow-auto bg-muted/40 p-6">
                {props.artifact.presentation === "image" && previewHref ? (
                  <div className="flex h-full min-h-[18rem] items-center justify-center rounded-2xl border border-border bg-card p-4">
                    <img
                      src={previewHref}
                      alt={props.artifact.name}
                      className="max-h-full w-auto max-w-full object-contain"
                    />
                  </div>
                ) : null}

                {props.artifact.presentation === "chart" ? (
                  <div className="overflow-hidden rounded-2xl border border-border bg-card">
                    <ChartArtifactPreview artifact={props.artifact} downloadHref={downloadHref} />
                  </div>
                ) : null}

                {props.artifact.presentation === "file" && previewHref && contentType === "application/pdf" ? (
                  <div className="h-full min-h-[28rem] overflow-hidden rounded-2xl border border-border bg-card">
                    <object
                      data={previewHref}
                      type="application/pdf"
                      className="h-full min-h-[28rem] w-full"
                      aria-label={`${props.artifact.name} PDF 미리보기`}
                    >
                      <div className="flex h-full min-h-[28rem] items-center justify-center px-6 text-center text-body-md text-muted-foreground">
                        브라우저에서 PDF 인라인 미리보기를 지원하지 않습니다. 상단의 열기나 다운로드를 사용할 수 있습니다.
                      </div>
                    </object>
                  </div>
                ) : null}

                {supportsHtmlPreview ? (
                  <HtmlArtifactPreview
                    downloadHref={downloadHref}
                    name={props.artifact.name}
                  />
                ) : null}

                {supportsPowerPointPreview ? (
                  <PptxArtifactPreview
                    contentType={props.artifact.contentType}
                    downloadHref={downloadHref}
                    name={props.artifact.name}
                    previewHref={previewHref}
                  />
                ) : null}

                {props.artifact.presentation === "file" && previewHref && contentType.startsWith("audio/") ? (
                  <div className="flex h-full min-h-[18rem] items-center justify-center rounded-2xl border border-border bg-card p-6">
                    <audio controls className="w-full max-w-2xl" src={previewHref}>
                      브라우저가 오디오 미리보기를 지원하지 않습니다.
                    </audio>
                  </div>
                ) : null}

                {props.artifact.presentation === "file" && contentType.startsWith("video/") ? (
                  <InlineVideoArtifactPreview previewHref={previewHref} />
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </>
    );
  }

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
        props.className,
      )}
    >
      {props.artifact.presentation === "image" && props.artifact.previewable && previewHref ? (
        <a
          href={previewHref}
          target="_blank"
          rel="noreferrer"
          className="block border-b border-border bg-secondary"
        >
          <img
            src={previewHref}
            alt={props.artifact.name}
            className="max-h-80 w-full object-contain"
            loading="lazy"
          />
        </a>
      ) : null}
      {props.artifact.presentation === "chart" ? (
        <ChartArtifactPreview
          artifact={props.artifact}
          downloadHref={downloadHref}
        />
      ) : null}

      <div className="space-y-4 px-4 py-4">
        <div className="space-y-1">
          <div className="text-label-md font-semibold uppercase -wide text-muted-foreground">
            {artifactLabel(props.artifact)}
          </div>
          <div className="text-body-md font-semibold text-foreground">{props.artifact.name}</div>
          <div className="text-label-md uppercase  text-muted-foreground">
            {props.artifact.role} · {props.artifact.contentType}
          </div>
          <div className="text-body-md leading-6 text-muted-foreground">
            {artifactSupportText(props.artifact)}
            {" · "}
            {formatBytes(props.artifact.size)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {supportsHtmlPreview || supportsPowerPointPreview ? (
            <button
              type="button"
              onClick={handlePreview}
              className={`${ACTION_LINK_BASE} rounded-full border border-border bg-secondary px-3 py-1.5 text-body-md font-medium !text-foreground visited:!text-foreground transition hover:bg-muted`}
            >
              {supportsPowerPointPreview ? "PPT 보기" : "HTML 보기"}
            </button>
          ) : null}
          {previewHref ? (
            <a
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              className={`${ACTION_LINK_BASE} rounded-full border border-border bg-secondary px-3 py-1.5 text-body-md font-medium !text-foreground visited:!text-foreground transition hover:bg-muted`}
            >
              {props.artifact.previewable ? "미리보기 열기" : "미리보기 라우트"}
            </a>
          ) : null}
          <a
            href={downloadHref}
            target="_blank"
            rel="noreferrer"
            className={`${ACTION_LINK_BASE} rounded-full border border-primary bg-primary px-3 py-1.5 text-body-md font-medium !text-primary-foreground visited:!text-primary-foreground transition hover:bg-primary/80`}
          >
            다운로드
          </a>
          {showInspectLink && props.runId ? (
            <Link
              to={`/runs/${props.runId}`}
              className={`${ACTION_LINK_BASE} rounded-full border border-border bg-secondary px-3 py-1.5 text-body-md font-medium !text-secondary-foreground visited:!text-secondary-foreground transition hover:bg-secondary`}
            >
              실행 검사
            </Link>
          ) : null}
        </div>
      </div>

      {supportsHtmlPreview || supportsPowerPointPreview ? (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="flex h-[min(88vh,56rem)] max-h-[88vh] w-[min(96vw,72rem)] max-w-[72rem] flex-col gap-0 overflow-hidden border-border bg-background p-0">
            <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
              <DialogTitle className="min-w-0 text-xl font-semibold text-foreground">
                {props.artifact.name}
              </DialogTitle>
              <DialogDescription className="mt-1 break-all text-body-sm leading-6">
                {props.artifact.role} · {props.artifact.contentType}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 custom-scrollbar overflow-auto bg-muted/40 p-6">
              {supportsHtmlPreview ? (
                <HtmlArtifactPreview
                  downloadHref={downloadHref}
                  name={props.artifact.name}
                />
              ) : null}
              {supportsPowerPointPreview ? (
                <PptxArtifactPreview
                  contentType={props.artifact.contentType}
                  downloadHref={downloadHref}
                  name={props.artifact.name}
                  previewHref={previewHref}
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </article>
  );
}
