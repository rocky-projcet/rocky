import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";

import { PptxArtifactPreview } from "@/domains/run/components/pptx-artifact-preview";
import { Button } from "@/shared/ui/button";
import { agentEngineClient } from "@/shared/lib/api-client";
import type { AgentWorkspaceFilePreviewRecord } from "@/shared/lib/agent-engine-client";

const PPT_CONTENT_TYPE = "application/vnd.ms-powerpoint";
const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const TEXT_WORKSPACE_PREVIEW_KINDS = new Set([
  "text",
  "code",
  "markdown",
  "html",
]);

function baseContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isPowerPointFile(name: string, contentType: string): boolean {
  const normalizedType = baseContentType(contentType);
  const normalizedName = name.toLowerCase();

  return (
    normalizedType === PPT_CONTENT_TYPE ||
    normalizedType === PPTX_CONTENT_TYPE ||
    normalizedName.endsWith(".ppt") ||
    normalizedName.endsWith(".pptx")
  );
}

function WorkspaceFilePreviewBody({
  record,
}: {
  record: AgentWorkspaceFilePreviewRecord;
}) {
  const inlinePreviewHref = record.inlinePreviewUrl
    ? agentEngineClient.resolveApiPath(record.inlinePreviewUrl)
    : null;
  const downloadHref = agentEngineClient.resolveApiPath(record.downloadUrl);

  if (isPowerPointFile(record.name, record.contentType)) {
    return (
      <div className="h-full bg-muted/40 p-4">
        <PptxArtifactPreview
          contentType={record.contentType}
          downloadHref={downloadHref}
          name={record.name}
          previewHref={null}
        />
      </div>
    );
  }

  if (
    TEXT_WORKSPACE_PREVIEW_KINDS.has(record.previewKind) &&
    typeof record.text === "string"
  ) {
    return (
      <pre className="min-h-full whitespace-pre-wrap break-words p-6 font-mono text-sm leading-6 text-foreground">
        {record.text || "빈 파일입니다."}
      </pre>
    );
  }

  if (record.previewKind === "image" && inlinePreviewHref) {
    return (
      <div className="flex min-h-full items-center justify-center bg-muted/40 p-4">
        <img
          src={inlinePreviewHref}
          alt={record.name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (record.previewKind === "audio" && inlinePreviewHref) {
    return (
      <div className="flex min-h-full items-center justify-center bg-muted/40 p-6">
        <audio controls src={inlinePreviewHref} className="w-full max-w-3xl" />
      </div>
    );
  }

  if (record.previewKind === "video" && inlinePreviewHref) {
    return (
      <video
        controls
        src={inlinePreviewHref}
        className="h-full w-full bg-black object-contain"
      />
    );
  }

  if (inlinePreviewHref) {
    return (
      <iframe
        title={`${record.name} 미리보기`}
        src={inlinePreviewHref}
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
      이 파일은 브라우저에서 바로 볼 수 없습니다. 다운로드로 확인해 주세요.
    </div>
  );
}

export function WorkspaceFilePreviewPage() {
  const [searchParams] = useSearchParams();
  const agentId = searchParams.get("agentId")?.trim() ?? "";
  const searchPath = searchParams.get("path")?.trim() ?? "";
  const previewQuery = useQuery({
    queryKey: ["workspace-file-preview-page", agentId, searchPath],
    queryFn: () => agentEngineClient.getAgentWorkspaceFilePreview(agentId, searchPath),
    enabled: Boolean(agentId && searchPath),
  });
  const record = previewQuery.data ?? null;
  const downloadHref = record
    ? agentEngineClient.resolveApiPath(record.downloadUrl)
    : agentId && searchPath
      ? agentEngineClient.agentWorkspaceFileDownloadUrl(agentId, searchPath)
      : null;

  return (
    <div className="flex h-svh min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Workspace Preview
          </div>
          <h1 className="mt-1 truncate text-base font-semibold text-foreground">
            {record?.name ?? searchPath.split("/").filter(Boolean).at(-1) ?? "파일"}
          </h1>
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {searchPath || "경로 없음"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="새로고침"
            title="새로고침"
            disabled={!agentId || !searchPath || previewQuery.isFetching}
            onClick={() => {
              void previewQuery.refetch();
            }}
          >
            <RefreshCw className="size-4" />
          </Button>
          {downloadHref ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="다운로드"
              title="다운로드"
              render={<a href={downloadHref} target="_blank" rel="noreferrer" />}
            >
              <Download className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        {!agentId || !searchPath ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            열 파일 경로가 없습니다.
          </div>
        ) : previewQuery.isLoading ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            파일을 불러오는 중입니다.
          </div>
        ) : previewQuery.isError ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            파일을 불러오지 못했습니다.
          </div>
        ) : record ? (
          <WorkspaceFilePreviewBody record={record} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            파일 정보가 없습니다.
          </div>
        )}
      </main>
    </div>
  );
}
