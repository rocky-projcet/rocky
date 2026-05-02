import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AudioLines,
  ChevronRight,
  ChevronUp,
  Code2,
  Download,
  File,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  ImageIcon,
  RotateCw,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { agentEngineClient } from "@/shared/lib/api-client";
import {
  useAgentWorkspaceDirectoryQuery,
  useAgentWorkspaceFilePreviewQuery,
} from "../hooks";

import type {
  AgentWorkspaceFilePreviewRecord,
  AgentWorkspacePreviewKind,
} from "../types";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { MarkdownDocumentPreview } from "@/shared/components/markdown-document-preview";
import { WorkspaceAwareMarkdownLink } from "@/shared/components/workspace-aware-markdown-link";
import { IconButton } from "@/shared/ui/icon-button";
import {
  type WorkspacePreviewPathKind,
} from "@/shared/lib/workspace-link-target";
import { SyntaxCodeBlock } from "@/shared/ui/syntax-code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

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

function formatUpdatedAt(value: string): string {
  return new Date(value).toLocaleString();
}

function normalizedContentType(contentType: string | null | undefined): string {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function pathSegments(searchPath: string): Array<{ label: string; path: string }> {
  if (!searchPath) {
    return [];
  }

  return searchPath.split("/").reduce<Array<{ label: string; path: string }>>((segments, part) => {
    const previous = segments.at(-1)?.path ?? "";
    const nextPath = previous ? `${previous}/${part}` : part;
    segments.push({
      label: part,
      path: nextPath,
    });
    return segments;
  }, []);
}

function fileExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
}

function previewKindLabel(previewKind: AgentWorkspacePreviewKind | null): string {
  switch (previewKind) {
    case "code":
      return "코드";
    case "markdown":
      return "Markdown";
    case "html":
      return "HTML";
    case "image":
      return "이미지";
    case "audio":
      return "오디오";
    case "video":
      return "영상";
    case "document":
      return "문서";
    case "binary":
      return "바이너리";
    case "text":
    default:
      return "텍스트";
  }
}

function previewKindIcon(previewKind: AgentWorkspacePreviewKind | null, kind: "directory" | "file") {
  if (kind === "directory") {
    return <Folder size={18} />;
  }

  switch (previewKind) {
    case "code":
      return <Code2 size={18} />;
    case "markdown":
    case "text":
      return <FileText size={18} />;
    case "html":
      return <Globe size={18} />;
    case "image":
      return <ImageIcon size={18} />;
    case "audio":
      return <AudioLines size={18} />;
    case "video":
      return <Video size={18} />;
    case "document":
      return <FileText size={18} />;
    case "binary":
    default:
      return <File size={18} />;
  }
}

function formattedCodeText(record: AgentWorkspaceFilePreviewRecord): string {
  const source = record.text ?? "";
  const contentType = normalizedContentType(record.contentType);
  const extension = fileExtension(record.name);

  if (contentType === "application/json" || extension === ".json") {
    try {
      return `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    } catch {
      return source;
    }
  }

  return source;
}

function codeLanguageMetadata(record: AgentWorkspaceFilePreviewRecord): {
  label: string;
  language: string | null;
} {
  const basename = record.name.toLowerCase();
  const extension = fileExtension(record.name);
  const contentType = normalizedContentType(record.contentType);
  const languages: Record<string, { label: string; language: string | null }> = {
    ".bash": { label: "Shell", language: "bash" },
    ".cjs": { label: "JavaScript", language: "js" },
    ".conf": { label: "Config", language: "ini" },
    ".css": { label: "CSS", language: "css" },
    ".go": { label: "Go", language: "go" },
    ".html": { label: "HTML", language: "html" },
    ".htm": { label: "HTML", language: "html" },
    ".ini": { label: "INI", language: "ini" },
    ".java": { label: "Java", language: "java" },
    ".js": { label: "JavaScript", language: "js" },
    ".json": { label: "JSON", language: "json" },
    ".jsonl": { label: "JSONL", language: "json" },
    ".jsx": { label: "React", language: "jsx" },
    ".md": { label: "Markdown", language: "markdown" },
    ".markdown": { label: "Markdown", language: "markdown" },
    ".mjs": { label: "JavaScript", language: "js" },
    ".php": { label: "PHP", language: "php" },
    ".py": { label: "Python", language: "python" },
    ".rb": { label: "Ruby", language: "ruby" },
    ".rs": { label: "Rust", language: "rust" },
    ".scss": { label: "SCSS", language: "scss" },
    ".sh": { label: "Shell", language: "bash" },
    ".sql": { label: "SQL", language: "sql" },
    ".template": { label: "Config", language: "ini" },
    ".toml": { label: "TOML", language: "toml" },
    ".ts": { label: "TypeScript", language: "ts" },
    ".tsx": { label: "TSX", language: "tsx" },
    ".xml": { label: "XML", language: "xml" },
    ".yaml": { label: "YAML", language: "yaml" },
    ".yml": { label: "YAML", language: "yaml" },
    ".zsh": { label: "Shell", language: "bash" },
  };

  if (basename === ".env" || basename.startsWith(".env.")) {
    return {
      label: "Env",
      language: "dotenv",
    };
  }

  if (contentType === "application/json") {
    return {
      label: "JSON",
      language: "json",
    };
  }

  return languages[extension] ?? {
    label: "Code",
    language: null,
  };
}

function TruncatedLabel(props: {
  text: string;
  className?: string;
  tooltipLabel?: string;
}) {
  const [labelElement, setLabelElement] = useState<HTMLSpanElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
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
  }, [labelElement, props.text]);

  const label = (
    <span ref={setLabelElement} className={cn("block truncate", props.className)}>
      {props.text}
    </span>
  );

  if (!isTruncated) {
    return label;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="block min-w-0 max-w-full cursor-help rounded-md outline-hidden transition focus-visible:ring-2 focus-visible:ring-ring/50">
            {label}
          </span>
        }
      />
      <TooltipContent
        side="top"
        align="start"
        sideOffset={8}
        className="max-w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-background/10 bg-foreground/98 px-3 py-2 text-xs leading-5 text-background shadow-2xl whitespace-normal break-all"
      >
        {props.tooltipLabel ?? props.text}
      </TooltipContent>
    </Tooltip>
  );
}

function CodePreviewPanel(props: {
  record: AgentWorkspaceFilePreviewRecord;
  text: string;
  compact?: boolean;
}) {
  const language = codeLanguageMetadata(props.record);
  const lines = props.text.split(/\r?\n/);

  return (
    <div className="h-full custom-scrollbar overflow-auto bg-slate-950 text-slate-100">
      <div
        className={cn(
          "sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 backdrop-blur",
          props.compact ? "px-3 py-2" : "px-4 py-3",
        )}
      >
        <span className="text-xs uppercase text-slate-300">
          {language.label}
        </span>
        <span className="text-xs text-slate-400">
          {props.record.lineCount ?? lines.length}줄
          {props.record.truncated ? " · 잘림" : ""}
        </span>
      </div>
      <SyntaxCodeBlock code={props.text} language={language.language} />
    </div>
  );
}

function TextPreviewPanel(props: {
  record: AgentWorkspaceFilePreviewRecord;
  text: string;
  compact?: boolean;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b border-border text-xs text-muted-foreground",
          props.compact ? "px-3 py-2" : "px-4 py-3",
        )}
      >
        <span>{props.record.contentType}</span>
        <span>
          {props.record.lineCount ?? 0}줄
          {props.record.truncated ? " · 잘림" : ""}
        </span>
      </div>
      <div className={cn("min-h-0 flex-1 custom-scrollbar overflow-auto", props.compact ? "px-3 py-3" : "px-4 py-4")}>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-foreground">
          {props.text}
        </pre>
      </div>
    </div>
  );
}

function SourceTextPanel(props: {
  record: AgentWorkspaceFilePreviewRecord;
  text: string;
  compact?: boolean;
}) {
  return <CodePreviewPanel record={props.record} text={props.text} compact={props.compact} />;
}

function MarkdownPreviewPanel(props: {
  record: AgentWorkspaceFilePreviewRecord;
  text: string;
  workspaceRoot: string;
  onOpenWorkspacePath: (path: string, pathKind: WorkspacePreviewPathKind) => void;
  compact?: boolean;
}) {
  return (
    <Tabs key={props.record.path} defaultValue="preview" className="flex h-full min-h-0 flex-col gap-0">
      <div className={cn("shrink-0 border-b border-border", props.compact ? "px-3 py-2" : "px-4 py-3")}>
        <TabsList className="rounded-full bg-muted p-1">
          <TabsTrigger value="preview">미리보기</TabsTrigger>
          <TabsTrigger value="source">원본</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="preview"
        className="min-h-0 flex-1 overflow-hidden"
      >
        <MarkdownDocumentPreview
          markdown={props.text}
          className={props.compact ? "px-3 py-3" : "px-5 py-5"}
          components={{
            a: ({ children, href }) => (
              <WorkspaceAwareMarkdownLink
                href={href}
                workspaceRoot={props.workspaceRoot}
                onOpenWorkspacePath={props.onOpenWorkspacePath}
                className="inline border-0 bg-transparent p-0 font-medium text-foreground underline decoration-border underline-offset-4"
              >
                {children}
              </WorkspaceAwareMarkdownLink>
            ),
          }}
        />
      </TabsContent>

      <TabsContent value="source" className="min-h-0 flex-1 overflow-hidden">
        <SourceTextPanel record={props.record} text={props.text} compact={props.compact} />
      </TabsContent>
    </Tabs>
  );
}

function HtmlPreviewPanel(props: {
  record: AgentWorkspaceFilePreviewRecord;
  text: string;
  compact?: boolean;
}) {
  return (
    <Tabs key={props.record.path} defaultValue="preview" className="flex h-full min-h-0 flex-col gap-0">
      <div className={cn("shrink-0 border-b border-border", props.compact ? "px-3 py-2" : "px-4 py-3")}>
        <TabsList className="rounded-full bg-muted p-1">
          <TabsTrigger value="preview">미리보기</TabsTrigger>
          <TabsTrigger value="source">원본</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="preview" className="min-h-0 flex-1 overflow-hidden bg-white">
        <iframe
          title={`${props.record.name} HTML 미리보기`}
          srcDoc={props.text}
          sandbox=""
          className="h-full w-full border-0"
        />
      </TabsContent>

      <TabsContent value="source" className="min-h-0 flex-1 overflow-hidden">
        <SourceTextPanel record={props.record} text={props.text} compact={props.compact} />
      </TabsContent>
    </Tabs>
  );
}

function VideoPreviewPanel(props: {
  previewHref: string | null;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [props.previewHref]);

  if (!props.previewHref) {
    return (
      <UnsupportedPreviewMessage>
        이 영상 파일은 인라인 미리보기를 지원하지 않습니다.
      </UnsupportedPreviewMessage>
    );
  }

  if (failed) {
    return (
      <UnsupportedPreviewMessage>
        브라우저가 이 영상 코덱을 재생하지 못했습니다. H.264(`avc1`) 또는 WebM 형식으로 다시 저장한 뒤 확인할 수 있습니다.
      </UnsupportedPreviewMessage>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-black p-4">
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

function WorkspacePreviewSurface(props: {
  record: AgentWorkspaceFilePreviewRecord;
  previewHref: string | null;
  workspaceRoot: string;
  onOpenWorkspacePath: (path: string, pathKind: WorkspacePreviewPathKind) => void;
  compact?: boolean;
}) {
  const formattedText = formattedCodeText(props.record);
  const contentType = normalizedContentType(props.record.contentType);

  switch (props.record.previewKind) {
    case "code":
      return <CodePreviewPanel record={props.record} text={formattedText} compact={props.compact} />;
    case "markdown":
      return (
        <MarkdownPreviewPanel
          record={props.record}
          text={props.record.text ?? ""}
          workspaceRoot={props.workspaceRoot}
          onOpenWorkspacePath={props.onOpenWorkspacePath}
          compact={props.compact}
        />
      );
    case "html":
      return <HtmlPreviewPanel record={props.record} text={props.record.text ?? ""} compact={props.compact} />;
    case "text":
      return <TextPreviewPanel record={props.record} text={props.record.text ?? ""} compact={props.compact} />;
    case "image":
      return props.previewHref ? (
        <div className={cn("flex h-full items-center justify-center custom-scrollbar overflow-auto bg-secondary/40", props.compact ? "p-1" : "p-4")}>
          <img
            src={props.previewHref}
            alt={props.record.name}
            className="max-h-full w-auto max-w-full rounded-xl object-contain shadow-sm"
          />
        </div>
      ) : (
        <UnsupportedPreviewMessage>
          이 이미지 파일은 브라우저 미리보기를 준비할 수 없습니다.
        </UnsupportedPreviewMessage>
      );
    case "audio":
      return props.previewHref ? (
        <div className={cn("flex h-full items-center justify-center bg-muted/40", props.compact ? "p-3" : "p-6")}>
          <audio controls className="w-full max-w-2xl" src={props.previewHref}>
            브라우저가 오디오 미리보기를 지원하지 않습니다.
          </audio>
        </div>
      ) : (
        <UnsupportedPreviewMessage>
          이 오디오 파일은 인라인 미리보기를 지원하지 않습니다.
        </UnsupportedPreviewMessage>
      );
    case "video":
      return <VideoPreviewPanel previewHref={props.previewHref} />;
    case "document":
      return props.previewHref && contentType === "application/pdf" ? (
        <div className="flex h-full flex-col overflow-hidden bg-muted/20">
          <div className={cn("flex shrink-0 justify-end border-b border-border", props.compact ? "px-3 py-2" : "px-4 py-3")}>
            <a
              href={props.previewHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition hover:bg-secondary"
            >
              새 탭에서 열기
            </a>
          </div>
          <object
            data={props.previewHref}
            type="application/pdf"
            className="min-h-0 flex-1"
          >
            <UnsupportedPreviewMessage>
              브라우저 내 PDF 미리보기를 사용할 수 없습니다. 상단의 새 탭 열기나 다운로드로 확인할 수 있습니다.
            </UnsupportedPreviewMessage>
          </object>
        </div>
      ) : (
        <UnsupportedPreviewMessage>
          이 문서 형식은 브라우저 인라인 미리보기를 지원하지 않습니다. PDF는 뷰어로, 그 외 문서는 다운로드로 확인할 수 있습니다.
        </UnsupportedPreviewMessage>
      );
    case "binary":
    default:
      return (
        <UnsupportedPreviewMessage>
          이 파일 유형은 미리보기를 제공하지 않습니다. 원본 다운로드로 확인할 수 있습니다.
        </UnsupportedPreviewMessage>
      );
  }
}

function UnsupportedPreviewMessage(props: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-6 text-center text-sm leading-6 text-muted-foreground">
        {props.children}
      </div>
    </div>
  );
}

function WorkspaceFilePreviewPanel(props: {
  agentId: string;
  selectedFilePath: string | null;
  record: AgentWorkspaceFilePreviewRecord | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  previewHref: string | null;
  downloadHref: string | null;
  workspaceRoot: string;
  onOpenWorkspacePath: (path: string, pathKind: WorkspacePreviewPathKind) => void;
  emptyStateTitle: string;
  emptyStateDescription: string;
  className?: string;
  bare?: boolean;
}) {
  const [folderOpenPending, setFolderOpenPending] = useState(false);

  function openActualFolder() {
    if (!props.selectedFilePath || folderOpenPending) {
      return;
    }

    setFolderOpenPending(true);
    agentEngineClient
      .openNativeFile(
        agentEngineClient.agentWorkspaceFolderNativeOpenPath(
          props.agentId,
          props.selectedFilePath
        )
      )
      .then(() => {
        toast.success("파일이 있는 실제 폴더를 열었습니다.");
      })
      .catch((error: unknown) => {
        toast.error("실제 폴더를 열지 못했습니다.", {
          description: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => setFolderOpenPending(false));
  }

  if (!props.selectedFilePath) {
    return (
      <div
        data-testid="agent-workspace-file-preview-empty"
        className={cn(
          "flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center",
          props.className,
        )}
      >
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">{props.emptyStateTitle}</p>
          <p className="text-sm leading-6 text-muted-foreground">
            {props.emptyStateDescription}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="agent-workspace-file-preview"
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        props.bare ? "" : "rounded-2xl border border-border bg-card",
        props.className,
      )}
    >
      <div className={cn("shrink-0 border-b border-border", props.bare ? "px-0 py-0 pb-4" : "px-5 py-4")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase text-muted-foreground">
              <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                {previewKindIcon(props.record?.previewKind ?? null, "file")}
              </span>
              <span>{previewKindLabel(props.record?.previewKind ?? null)}</span>
              {props.record ? (
                <>
                  <span>{formatBytes(props.record.size)}</span>
                  <span>{formatUpdatedAt(props.record.updatedAt)}</span>
                </>
              ) : null}
            </div>
            <div className="mt-3 min-w-0 text-xl">
              <TruncatedLabel
                text={
                  props.record?.name ??
                  props.selectedFilePath.slice(props.selectedFilePath.lastIndexOf("/") + 1) ??
                  ""
                }
                className="text-xl font-semibold text-foreground"
                tooltipLabel={props.selectedFilePath}
              />
            </div>
            <p className="mt-1 break-all text-xs leading-6 text-muted-foreground">
              {props.selectedFilePath}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={folderOpenPending}
              onClick={openActualFolder}
              title="실제 폴더 열기"
            >
              <FolderOpen size={14} />
              실제 폴더
            </Button>
            {props.downloadHref ? (
              <a
                href={props.downloadHref}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground no-underline transition hover:bg-secondary"
              >
                <Download size={14} />
                다운로드
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className={cn("min-h-0 flex-1", props.bare ? "py-4" : "px-5 py-4")}>
        {props.isLoading ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
            파일 미리보기 로딩 중...
          </div>
        ) : null}

        {props.isError ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
            {props.error instanceof Error
              ? props.error.message
              : "파일 미리보기를 불러올 수 없습니다."}
          </div>
        ) : null}

        {props.record ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-secondary px-3 py-1 text-foreground">
                {props.record.contentType}
              </span>
              {props.record.lineCount !== null ? (
                <span>
                  {props.record.lineCount}줄
                  {props.record.truncated ? " · 일부만 표시" : ""}
                </span>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-background">
              <WorkspacePreviewSurface
                record={props.record}
                previewHref={props.previewHref}
                workspaceRoot={props.workspaceRoot}
                onOpenWorkspacePath={props.onOpenWorkspacePath}
                compact={props.bare}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AgentWorkspaceBrowserPanel(props: {
  agentId: string;
  workspaceRoot: string;
  title?: string;
  description?: string;
  initialPath?: string;
  initialFilePath?: string | null;
  focusRequestKey?: number;
  showHeader?: boolean;
  embeddedTitle?: string;
  embeddedHeaderSuffix?: ReactNode;
}) {
  const embedded = props.showHeader === false;
  const [searchPath, setSearchPath] = useState(props.initialPath ?? "");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const directoryQuery = useAgentWorkspaceDirectoryQuery(props.agentId, searchPath);
  const filePreviewQuery = useAgentWorkspaceFilePreviewQuery(props.agentId, selectedFilePath);

  useEffect(() => {
    const initialFilePath = props.initialFilePath ?? null;
    if (initialFilePath) {
      const initialDirectoryPath = initialFilePath.includes("/")
        ? initialFilePath.slice(0, initialFilePath.lastIndexOf("/"))
        : "";
      setSearchPath(initialDirectoryPath);
      setSelectedFilePath(initialFilePath);
      return;
    }

    setSearchPath(props.initialPath ?? "");
    setSelectedFilePath(null);
  }, [props.agentId, props.initialFilePath, props.initialPath, props.focusRequestKey]);

  useEffect(() => {
    if (!directoryQuery.data || !selectedFilePath) {
      return;
    }

    const currentDirectory = directoryQuery.data.path;
    const stillVisible = directoryQuery.data.entries.some(
      (entry) => entry.kind === "file" && entry.path === selectedFilePath
    );

    if (!stillVisible) {
      const selectedDirectory = selectedFilePath.includes("/")
        ? selectedFilePath.slice(0, selectedFilePath.lastIndexOf("/"))
        : "";
      if (selectedDirectory !== currentDirectory) {
        setSelectedFilePath(null);
      }
    }
  }, [directoryQuery.data, selectedFilePath]);

  const breadcrumbs = useMemo(() => pathSegments(searchPath), [searchPath]);
  const currentPath = selectedFilePath ?? searchPath;
  const currentPathSegments = useMemo(() => pathSegments(currentPath), [currentPath]);
  const currentDirectorySegments = selectedFilePath
    ? currentPathSegments.slice(0, -1)
    : currentPathSegments;
  const selectedFileLabel = selectedFilePath ? (currentPathSegments.at(-1)?.label ?? null) : null;
  const previewHref =
    filePreviewQuery.data?.inlinePreviewUrl === null || !filePreviewQuery.data?.inlinePreviewUrl
      ? null
      : agentEngineClient.resolveApiPath(filePreviewQuery.data.inlinePreviewUrl);
  const downloadHref = filePreviewQuery.data
    ? agentEngineClient.resolveApiPath(filePreviewQuery.data.downloadUrl)
    : null;
  const canGoUp = !!directoryQuery.data && directoryQuery.data.parentPath !== null;

  const refreshWorkspace = () => {
    void directoryQuery.refetch();
    if (selectedFilePath) {
      void filePreviewQuery.refetch();
    }
  };

  const goUp = () => {
    if (!directoryQuery.data?.parentPath && directoryQuery.data?.parentPath !== "") {
      return;
    }

    setSearchPath(directoryQuery.data?.parentPath ?? "");
    setSelectedFilePath(null);
  };

  async function handleOpenWorkspacePath(
    path: string,
    pathKind: WorkspacePreviewPathKind
  ) {
    const normalizedPath = path.replace(/^\.\/+/, "").replace(/\/+$/, "");

    if (!normalizedPath) {
      setSearchPath("");
      setSelectedFilePath(null);
      return;
    }

    if (pathKind === "directory") {
      setSearchPath(normalizedPath);
      setSelectedFilePath(null);
      return;
    }

    if (pathKind === "file") {
      const directoryPath = normalizedPath.includes("/")
        ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))
        : "";
      setSearchPath(directoryPath);
      setSelectedFilePath(normalizedPath);
      return;
    }

    try {
      await agentEngineClient.listAgentWorkspace(props.agentId, normalizedPath);
      setSearchPath(normalizedPath);
      setSelectedFilePath(null);
      return;
    } catch {
      // Fall through and try the file preview endpoint.
    }

    try {
      await agentEngineClient.getAgentWorkspaceFilePreview(props.agentId, normalizedPath);
      const directoryPath = normalizedPath.includes("/")
        ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))
        : "";
      setSearchPath(directoryPath);
      setSelectedFilePath(normalizedPath);
    } catch {
      // Leave the current workspace view as-is when the link target is no longer valid.
    }
  }

  const directoryList = directoryQuery.data ? (
    <div className={embedded ? "min-h-0 flex-1 overflow-hidden" : "h-80 overflow-hidden"}>
      {directoryQuery.data.entries.length === 0 ? (
        <div className="flex h-full items-center rounded-2xl border border-dashed border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
          이 폴더는 비어 있습니다.
        </div>
      ) : (
        <div
          className={cn(
            "flex h-full flex-col gap-1 custom-scrollbar overflow-y-auto",
            embedded ? "pr-0" : "pr-1",
          )}
        >
          {directoryQuery.data.entries.map((entry) => {
            const selected = entry.kind === "file" && selectedFilePath === entry.path;
            const secondaryText = entry.kind === "file" ? formatBytes(entry.size) : null;

            return (
              <Button
                key={entry.path}
                onClick={() => {
                  if (entry.kind === "directory") {
                    setSearchPath(entry.path);
                    setSelectedFilePath(null);
                    return;
                  }

                  setSelectedFilePath((current) => (current === entry.path ? null : entry.path));
                }}
                variant="ghost"
                className={cn(
                  "flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-0 text-left transition",
                  selected
                    ? "border-accent/40 bg-accent/10"
                    : "border-border bg-card hover:bg-muted/50",
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                    {previewKindIcon(entry.previewKind, entry.kind)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <TruncatedLabel
                      text={entry.name}
                      className="text-xs font-medium text-foreground"
                      tooltipLabel={entry.path}
                    />
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {secondaryText ? (
                    <span className="text-[11px] text-muted-foreground">{secondaryText}</span>
                  ) : null}
                  <ChevronRight size={13} />
                </div>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <div
        className={cn(
          "min-w-0 text-foreground",
          embedded ? "flex h-full min-h-0 flex-col" : "",
        )}
      >
        {props.showHeader !== false ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-lg font-semibold text-foreground">
                {props.title ?? "에이전트 워크스페이스"}
              </h4>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {props.description ??
                  "이 에이전트의 모든 세션은 동일한 워크스페이스를 읽고 씁니다."}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <IconButton
                variant="outline"
                size="xs"
                onClick={refreshWorkspace}
                label="워크스페이스 새로고침"
              >
                <RotateCw size={14} />
              </IconButton>
              <IconButton
                variant="outline"
                size="xs"
                onClick={goUp}
                disabled={!canGoUp}
                label="상위 폴더로 이동"
              >
                <ChevronUp size={14} />
              </IconButton>
            </div>
          </div>
        ) : null}

        {embedded ? (
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/70 pb-3">
            <div className="-mx-1 min-w-0 flex-1 custom-scrollbar overflow-x-auto px-1">
              <div className="flex min-w-max items-center gap-2 text-xs uppercase text-muted-foreground">
                <Button
                  variant={currentPath === "" ? "default" : "secondary"}
                  size="xs"
                  onClick={() => {
                    setSearchPath("");
                    setSelectedFilePath(null);
                  }}
                >
                  root
                </Button>

                {currentDirectorySegments.map((segment) => (
                  <Button
                    key={segment.path}
                    variant={segment.path === searchPath ? "default" : "secondary"}
                    size="xs"
                    onClick={() => {
                      setSearchPath(segment.path);
                      setSelectedFilePath(null);
                    }}
                  >
                    {segment.label}
                  </Button>
                ))}

                {selectedFileLabel ? (
                  <span className="inline-flex max-w-[20rem] items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium normal-case text-foreground">
                    {selectedFileLabel}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IconButton
                variant="outline"
                size="xs"
                onClick={refreshWorkspace}
                label="공유 워크스페이스 새로고침"
              >
                <RotateCw size={14} />
              </IconButton>
              <IconButton
                variant="outline"
                size="xs"
                onClick={goUp}
                disabled={!canGoUp}
                label="상위 폴더로 이동"
              >
                <ChevronUp size={14} />
              </IconButton>
              {props.embeddedHeaderSuffix}
            </div>
          </div>
        ) : null}

        {!embedded ? (
          <div
            className={cn(
              props.showHeader === false ? "" : "mt-4",
              "rounded-2xl border border-border bg-card px-4 py-4",
            )}
          >
            <div className="-mx-1 custom-scrollbar overflow-x-auto pb-1">
              <div className="flex min-w-max items-center gap-2 px-1 text-xs uppercase text-muted-foreground">
                <Button
                  variant={searchPath === "" ? "default" : "secondary"}
                  size="xs"
                  onClick={() => {
                    setSearchPath("");
                    setSelectedFilePath(null);
                  }}
                >
                  root
                </Button>

                {breadcrumbs.map((segment) => (
                  <Button
                    key={segment.path}
                    variant={segment.path === searchPath ? "default" : "secondary"}
                    size="xs"
                    onClick={() => {
                      setSearchPath(segment.path);
                      setSelectedFilePath(null);
                    }}
                  >
                    {segment.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            embedded ? "" : "mt-4",
            embedded ? "flex min-h-0 flex-1 flex-col" : "space-y-4",
          )}
        >
          <div
            className={cn(
              "min-h-0",
              embedded
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : "rounded-2xl border border-border bg-card px-4 py-4",
            )}
          >
            {directoryQuery.isLoading ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
                워크스페이스 트리 로딩 중...
              </div>
            ) : null}

            {directoryQuery.isError ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                {directoryQuery.error instanceof Error
                  ? directoryQuery.error.message
                  : "워크스페이스 트리를 불러올 수 없습니다."}
              </div>
            ) : null}

            {directoryQuery.data ? (
              directoryList
            ) : null}
          </div>
        </div>
      </div>

      <Dialog
        open={selectedFilePath !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedFilePath(null);
          }
        }}
      >
        <DialogContent className="flex h-[min(88vh,56rem)] max-h-[88vh] w-[min(96vw,72rem)] max-w-[72rem] flex-col gap-0 overflow-hidden border-border bg-background p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>
              {selectedFilePath?.slice(selectedFilePath.lastIndexOf("/") + 1) ?? "파일 미리보기"}
            </DialogTitle>
            <DialogDescription>{selectedFilePath ?? ""}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 p-6">
            <WorkspaceFilePreviewPanel
              agentId={props.agentId}
              selectedFilePath={selectedFilePath}
              record={filePreviewQuery.data}
              isLoading={filePreviewQuery.isLoading}
              isError={filePreviewQuery.isError}
              error={filePreviewQuery.error}
              previewHref={previewHref}
              downloadHref={downloadHref}
              workspaceRoot={props.workspaceRoot}
              onOpenWorkspacePath={handleOpenWorkspacePath}
              emptyStateTitle="파일을 선택하면 미리보기가 열립니다"
              emptyStateDescription="워크스페이스 파일을 골라 내용을 확인할 수 있습니다."
              className="h-full"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
