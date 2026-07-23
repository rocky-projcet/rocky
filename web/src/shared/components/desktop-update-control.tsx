import { useEffect } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";

import {
  useCheckRockyAppUpdateMutation,
  useDownloadRockyAppUpdateMutation,
  useRevealRockyAppUpdateInstallerMutation,
  useRockyAppUpdateQuery,
  useStartRockyAppUpdateInstallerMutation,
} from "@/domains/rocky/hooks";
import {
  appUpdateStatusLabel,
  canRevealAppUpdateDownload,
  primaryAppUpdateActionLabel,
  shouldAutoCheckAppUpdate,
  shouldAutoInstallAppUpdate,
} from "@/domains/rocky/lib/app-update";
import type { AppUpdateRecord } from "@/shared/lib/agent-engine-client";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { Progress } from "@/shared/ui/progress";

function formatBytes(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function platformLabel(record: AppUpdateRecord): string {
  if (record.platform === "darwin") {
    return "macOS · Universal";
  }
  if (record.platform === "win32") {
    return "Windows";
  }
  return record.platform;
}

function statusDotClass(record: AppUpdateRecord | null): string {
  if (record?.status === "failed") {
    return "bg-destructive";
  }
  if (
    record?.status === "checking" ||
    record?.status === "downloading" ||
    record?.status === "installing"
  ) {
    return "bg-amber-500";
  }
  if (record?.updateAvailable || record?.status === "downloaded") {
    return "bg-emerald-500";
  }
  return "hidden";
}

export function DesktopUpdateControl({
  className,
}: {
  className?: string;
}) {
  const updateQuery = useRockyAppUpdateQuery();
  const checkMutation = useCheckRockyAppUpdateMutation();
  const downloadMutation = useDownloadRockyAppUpdateMutation();
  const installMutation = useStartRockyAppUpdateInstallerMutation();
  const revealMutation = useRevealRockyAppUpdateInstallerMutation();
  const record = updateQuery.data ?? null;
  const refetchUpdate = updateQuery.refetch;
  const checkForUpdate = checkMutation.mutate;
  const checkPending = checkMutation.isPending;

  useEffect(() => {
    if (
      record &&
      shouldAutoCheckAppUpdate(record) &&
      !checkPending
    ) {
      checkForUpdate();
    }
  }, [checkForUpdate, checkPending, record]);

  useEffect(() => {
    if (!downloadMutation.isPending) {
      return;
    }

    void refetchUpdate();
    const interval = window.setInterval(() => {
      void refetchUpdate();
    }, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, [downloadMutation.isPending, refetchUpdate]);

  if (record?.status === "unsupported") {
    return null;
  }

  const busy =
    updateQuery.isLoading ||
    checkMutation.isPending ||
    downloadMutation.isPending ||
    installMutation.isPending ||
    record?.status === "checking" ||
    record?.status === "downloading" ||
    record?.status === "installing";
  const progress = record?.downloadProgress?.percent ?? 0;
  const statusLabel = record
    ? appUpdateStatusLabel(record)
    : updateQuery.isError
      ? "상태 확인 실패"
      : "업데이트 확인 중";
  const primaryLabel = record
    ? primaryAppUpdateActionLabel(record)
    : "다시 확인";
  const canReveal = record ? canRevealAppUpdateDownload(record) : false;

  async function showFailure(
    title: string,
    result?: AppUpdateRecord | null
  ) {
    toast.error(title, {
      description:
        result?.lastError ??
        (updateQuery.error instanceof Error
          ? updateQuery.error.message
          : undefined),
    });
  }

  async function startInstaller() {
    try {
      await installMutation.mutateAsync();
      toast.success("설치 프로그램을 열었습니다.");
    } catch (error) {
      await updateQuery.refetch();
      toast.error("설치 프로그램을 열지 못했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  async function downloadAndInstall() {
    const downloaded = await downloadMutation.mutateAsync();
    if (downloaded.status === "failed") {
      await showFailure("업데이트 파일을 다운로드하지 못했습니다.", downloaded);
      return;
    }
    if (shouldAutoInstallAppUpdate(downloaded)) {
      await startInstaller();
    }
  }

  async function handlePrimaryAction() {
    if (busy) {
      return;
    }

    try {
      if (!record) {
        await updateQuery.refetch();
        return;
      }
      if (record.status === "update-available") {
        await downloadAndInstall();
        return;
      }
      if (record.status === "downloaded") {
        await startInstaller();
        return;
      }
      if (record.status === "failed" && record.download?.verified) {
        await startInstaller();
        return;
      }
      if (record.status === "failed" && record.updateAvailable) {
        await downloadAndInstall();
        return;
      }

      const checked = await checkMutation.mutateAsync();
      if (checked.status === "failed") {
        await showFailure("최신 버전을 확인하지 못했습니다.", checked);
      }
    } catch (error) {
      toast.error("Rocky 업데이트 요청이 실패했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  async function handleRevealDownload() {
    try {
      await revealMutation.mutateAsync();
    } catch (error) {
      toast.error("다운로드 위치를 열지 못했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  const latestVersion = record?.latestVersion ?? record?.currentVersion ?? "-";
  const fileSize =
    formatBytes(record?.download?.size) ??
    formatBytes(record?.installerAsset?.size);

  return (
    <div
      data-desktop-update
      className={cn(
        "relative shrink-0 [-webkit-app-region:no-drag]",
        className,
      )}
    >
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="relative size-8 rounded-lg text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
              aria-label="Rocky 업데이트"
              title={statusLabel}
            />
          }
        >
          <Download className="size-4" />
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-1.5 top-1.5 size-1.5 rounded-full ring-2 ring-background",
              statusDotClass(record),
            )}
          />
        </PopoverTrigger>

        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={8}
          className="w-[min(23rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-2xl border border-border/80 bg-popover p-0 shadow-xl [-webkit-app-region:no-drag]"
        >
          <div className="flex items-start gap-3 px-4 pb-3 pt-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground text-background">
              <Download className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">
                  Rocky {latestVersion}
                </h2>
                <Badge
                  variant={record?.updateAvailable ? "secondary" : "outline"}
                  className="h-5 rounded-full px-2 text-[10px]"
                >
                  {statusLabel}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                현재 버전 {record?.currentVersion ?? "-"}
              </p>
            </div>
          </div>

          {record?.lastError || updateQuery.isError ? (
            <div className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/8 px-3 py-2.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {record?.lastError ??
                  (updateQuery.error instanceof Error
                    ? updateQuery.error.message
                    : "업데이트 상태를 확인하지 못했습니다.")}
              </span>
            </div>
          ) : null}

          {record?.releaseNotes ? (
            <div className="mx-4 mb-3 max-h-32 overflow-y-auto rounded-xl border bg-muted/45 px-3 py-2.5">
              <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                {record.releaseNotes}
              </p>
            </div>
          ) : record?.updateAvailable ? (
            <div className="mx-4 mb-3 rounded-xl border bg-muted/45 px-3 py-2.5 text-xs text-muted-foreground">
              이 릴리스에는 별도의 업데이트 내용이 제공되지 않았습니다.
            </div>
          ) : null}

          {record?.status === "downloading" ? (
            <div className="mx-4 mb-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  업데이트 다운로드 중
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {record.downloadProgress?.percent ?? 0}%
                </span>
              </div>
              <Progress value={progress} />
            </div>
          ) : null}

          {record?.limitations.length ? (
            <ul className="mx-4 mb-3 space-y-1.5 rounded-xl border bg-background px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              {record.limitations.map((limitation) => (
                <li key={limitation} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{limitation}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="border-t px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{record ? platformLabel(record) : "Rocky Desktop"}</span>
              <span className="truncate text-right">
                {[record?.installerAsset?.name, fileSize]
                  .filter(Boolean)
                  .join(" · ") || "설치 파일 확인 전"}
              </span>
            </div>
            <Button
              type="button"
              className="w-full rounded-xl"
              disabled={
                busy ||
                record?.status === "install-started"
              }
              onClick={() => void handlePrimaryAction()}
            >
              {busy ? statusLabel : primaryLabel}
            </Button>
            <div className="mt-2 flex items-center justify-between">
              {record?.releaseUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="px-2 text-xs text-muted-foreground"
                  render={
                    <a
                      href={record.releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  <ExternalLink className="size-3.5" />
                  Release
                </Button>
              ) : (
                <span />
              )}
              {canReveal ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="px-2 text-xs text-muted-foreground"
                  disabled={revealMutation.isPending}
                  onClick={() => void handleRevealDownload()}
                >
                  <FolderOpen className="size-3.5" />
                  다운로드 위치
                </Button>
              ) : null}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
