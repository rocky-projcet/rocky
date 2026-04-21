import type { ReactNode } from "react";

import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";
import { Progress } from "@/shared/ui/progress";
import { PageState } from "@/shared/components/page-state";
import { useHardwareStatusQuery } from "../hooks";
import type { HardwareGpuMemoryKind, HardwareStatusRecord } from "../types";

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "확인 불가";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "확인 중";
  }

  return `${value.toFixed(1)}%`;
}

function formatClock(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "확인 불가";
  }

  return `${value.toFixed(1)} GHz`;
}

function formatLoad(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "확인 불가";
  }

  return value.toFixed(2);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function memoryKindLabel(kind: HardwareStatusRecord["memory"]["kind"]): string {
  return kind === "unified" ? "통합 메모리" : "RAM";
}

function gpuMemoryKindLabel(kind: HardwareGpuMemoryKind): string {
  switch (kind) {
    case "unified":
      return "통합 메모리";
    case "dedicated":
      return "전용 VRAM";
    case "shared":
      return "공유 메모리";
    case "integrated":
      return "내장 GPU";
    default:
      return "GPU 메모리";
  }
}

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function UsageCard({
  title,
  description,
  percent,
  primaryValue,
  children,
}: {
  title: string;
  description: string;
  percent: number | null;
  primaryValue: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge className="rounded-full px-3 py-1 text-xs font-semibold">
          {primaryValue}
        </Badge>
      </div>

      <div className="space-y-2">
        <Progress value={percent ?? 0} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>사용률</span>
          <span>{formatPercent(percent)}</span>
        </div>
      </div>

      <div className="space-y-3">{children}</div>
    </Card>
  );
}

export function HardwareStatusPanel({
  enabled,
}: {
  enabled: boolean;
}) {
  const hardwareQuery = useHardwareStatusQuery(enabled);

  if (!enabled) {
    return null;
  }

  if (hardwareQuery.isError) {
    return (
      <PageState
        eyebrow="오류"
        title="하드웨어 상태를 읽을 수 없습니다"
        description={
          hardwareQuery.error instanceof Error
            ? hardwareQuery.error.message
            : "현재 기기 상태를 읽는 중 오류가 발생했습니다."
        }
      />
    );
  }

  if (hardwareQuery.isLoading || !hardwareQuery.data) {
    return (
      <PageState
        eyebrow="로딩"
        title="하드웨어 상태를 읽는 중입니다"
        description="로컬 AI 실행에 필요한 CPU, 메모리, GPU, 저장공간 정보를 불러오고 있습니다."
      />
    );
  }

  const hardware = hardwareQuery.data;
  const gpuCards =
    hardware.gpus.length > 0 ? (
      <div className="grid gap-4 xl:grid-cols-2">
        {hardware.gpus.map((gpu, index) => (
          <Card key={`${gpu.name ?? "gpu"}-${index}`} className="gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {gpu.name ?? `GPU ${index + 1}`}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {gpu.vendor ?? "벤더 정보 없음"}
                </p>
              </div>
              <Badge className="rounded-full px-3 py-1 text-xs font-semibold">
                {gpuMemoryKindLabel(gpu.memoryKind)}
              </Badge>
            </div>

            <div className="space-y-3">
              <MetricRow label="메모리" value={formatBytes(gpu.memoryBytes)} />
              <MetricRow
                label="GPU 사용률"
                value={
                  gpu.utilizationPercent !== null
                    ? formatPercent(gpu.utilizationPercent)
                    : "확인 불가"
                }
              />
              <MetricRow
                label="코어"
                value={gpu.coreCount !== null ? `${gpu.coreCount}개` : "확인 불가"}
              />
            </div>

            {gpu.note ? (
              <div className="rounded-3xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                {gpu.note}
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    ) : (
      <Card className="gap-3 p-5">
        <p className="text-sm font-semibold text-foreground">GPU 상태</p>
        <p className="text-sm text-muted-foreground">
          현재 환경에서는 GPU 세부 정보를 읽을 수 없습니다. CPU, 메모리, 저장공간 지표를 함께 참고하세요.
        </p>
      </Card>
    );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          CPU, {memoryKindLabel(hardware.memory.kind)}, GPU, 저장공간을 10초마다 다시 읽어 현재 로컬 AI 실행 환경을 확인합니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge className="rounded-full px-3 py-1 text-xs font-semibold">
            {hardware.platform} · {hardware.arch}
          </Badge>
          <Badge className="rounded-full px-3 py-1 text-xs font-semibold">
            {hardware.hostname}
          </Badge>
          <Badge className="rounded-full px-3 py-1 text-xs font-semibold">
            최근 갱신 {formatDateTime(hardware.refreshedAt)}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <UsageCard
          title="CPU"
          description={hardware.cpu.model ?? "CPU 모델 정보"}
          percent={hardware.cpu.usagePercent}
          primaryValue={formatPercent(hardware.cpu.usagePercent)}
        >
          <MetricRow
            label="코어"
            value={
              hardware.cpu.physicalCores !== null
                ? `물리 ${hardware.cpu.physicalCores} / 논리 ${hardware.cpu.logicalCores}`
                : `논리 ${hardware.cpu.logicalCores}`
            }
          />
          <MetricRow label="클럭" value={formatClock(hardware.cpu.speedGHz)} />
          <MetricRow
            label="1분 부하"
            value={`${formatLoad(hardware.cpu.loadAverage.oneMinute)} (${formatPercent(
              hardware.cpu.normalizedLoadPercent
            )})`}
          />
          <MetricRow
            label="5 / 15분 부하"
            value={`${formatLoad(hardware.cpu.loadAverage.fiveMinute)} / ${formatLoad(
              hardware.cpu.loadAverage.fifteenMinute
            )}`}
          />
        </UsageCard>

        <UsageCard
          title={memoryKindLabel(hardware.memory.kind)}
          description={
            hardware.memory.kind === "unified"
              ? "macOS에서는 CPU와 GPU가 같은 메모리 풀을 공유합니다."
              : "현재 시스템 메모리 사용량입니다."
          }
          percent={hardware.memory.usedPercent}
          primaryValue={formatPercent(hardware.memory.usedPercent)}
        >
          <MetricRow label="전체" value={formatBytes(hardware.memory.totalBytes)} />
          <MetricRow label="사용 중" value={formatBytes(hardware.memory.usedBytes)} />
          <MetricRow label="여유" value={formatBytes(hardware.memory.availableBytes)} />
          <MetricRow
            label="스왑"
            value={
              hardware.memory.swapTotalBytes !== null
                ? `${formatBytes(hardware.memory.swapUsedBytes)} / ${formatBytes(
                    hardware.memory.swapTotalBytes
                  )}`
                : "확인 불가"
            }
          />
        </UsageCard>

        <UsageCard
          title="저장공간"
          description={hardware.storage.path}
          percent={hardware.storage.usedPercent}
          primaryValue={formatPercent(hardware.storage.usedPercent)}
        >
          <MetricRow label="전체" value={formatBytes(hardware.storage.totalBytes)} />
          <MetricRow label="사용 중" value={formatBytes(hardware.storage.usedBytes)} />
          <MetricRow label="여유" value={formatBytes(hardware.storage.availableBytes)} />
        </UsageCard>
      </div>

      <section className="space-y-4">
        <div>
          <h4 className="text-lg font-semibold text-foreground">GPU</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            macOS에서는 별도 VRAM 대신 통합 메모리 기준으로 로컬 모델 구동 가능 범위를 판단합니다.
          </p>
        </div>
        {gpuCards}
      </section>
    </section>
  );
}
