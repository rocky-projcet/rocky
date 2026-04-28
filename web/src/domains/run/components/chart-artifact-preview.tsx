import { useEffect, useMemo, useState } from "react";

import type { AgentSessionArtifactManifestEntry } from "@/domains/session/types";
import type { RunArtifactRecord } from "../types";
import { parseSupportedChartSpec } from "../lib/safe-chart-spec";

type ArtifactLike = AgentSessionArtifactManifestEntry | RunArtifactRecord;

const CHART_FRAME_WIDTH = 640;
const CHART_FRAME_HEIGHT = 320;
const CHART_MARGIN = { top: 28, right: 24, bottom: 58, left: 56 };
const CHART_COLORS = ["#0f766e", "#d97706", "#2563eb", "#b91c1c", "#7c3aed"];

type ChartPreviewState =
  | { status: "loading" }
  | { status: "ready"; spec: ReturnType<typeof parseSupportedChartSpec> extends infer T ? Exclude<T, null> : never }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string };

function baseContentType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? value.toLowerCase();
}

function clampNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function escapePathLabel(value: string | number): string {
  return typeof value === "number" ? String(value) : value;
}

function buildChartGeometry(spec: Exclude<ChartPreviewState, { status: "loading" | "unsupported" | "error" }>["spec"]) {
  const plotWidth = CHART_FRAME_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_FRAME_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const allPoints = spec.series.flatMap((series) => series.points);
  const minY = Math.min(0, ...allPoints.map((point) => point.y));
  const maxY = Math.max(0, ...allPoints.map((point) => point.y));
  const ySpan = maxY - minY || 1;
  const yScale = (value: number) =>
    CHART_MARGIN.top + plotHeight - ((value - minY) / ySpan) * plotHeight;

  if (spec.xType === "number") {
    const numericValues = allPoints
      .map((point) => (typeof point.x === "number" ? point.x : Number.NaN))
      .filter(Number.isFinite);
    const minX = Math.min(...numericValues);
    const maxX = Math.max(...numericValues);
    const xSpan = maxX - minX || 1;

    return {
      plotWidth,
      plotHeight,
      yScale,
      xScale: (value: string | number) =>
        CHART_MARGIN.left + (((Number(value) - minX) / xSpan) * plotWidth),
      xTicks: Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const rawValue = minX + xSpan * ratio;
        return {
          value: rawValue,
          label: rawValue.toFixed(xSpan >= 4 ? 0 : 2),
          x: CHART_MARGIN.left + ratio * plotWidth,
        };
      }),
      yTicks: Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const rawValue = minY + ySpan * ratio;
        return {
          value: rawValue,
          label: rawValue.toFixed(ySpan >= 4 ? 0 : 2),
          y: yScale(rawValue),
        };
      }),
      categories: null as null,
    };
  }

  const categoryOrder = Array.from(
    new Set(allPoints.map((point) => escapePathLabel(point.x)))
  );
  const categoryStep = categoryOrder.length > 1 ? plotWidth / (categoryOrder.length - 1) : 0;
  const categoryIndex = new Map(categoryOrder.map((value, index) => [value, index]));

  return {
    plotWidth,
    plotHeight,
    yScale,
    xScale: (value: string | number) =>
      CHART_MARGIN.left + (categoryIndex.get(escapePathLabel(value)) ?? 0) * categoryStep,
    xTicks: categoryOrder.map((value, index) => ({
      value,
      label: value,
      x: CHART_MARGIN.left + index * categoryStep,
    })),
    yTicks: Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      const rawValue = minY + ySpan * ratio;
      return {
        value: rawValue,
        label: rawValue.toFixed(ySpan >= 4 ? 0 : 2),
        y: yScale(rawValue),
      };
    }),
    categories: categoryOrder,
  };
}

function buildLinePath(
  points: Array<{ x: number; y: number }>
): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${clampNumber(point.x)} ${clampNumber(point.y)}`)
    .join(" ");
}

function buildAreaPath(
  points: Array<{ x: number; y: number }>,
  baselineY: number
): string {
  if (points.length === 0) {
    return "";
  }

  const linePath = buildLinePath(points);
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];

  return `${linePath} L ${clampNumber(lastPoint?.x ?? 0)} ${baselineY} L ${clampNumber(firstPoint?.x ?? 0)} ${baselineY} Z`;
}

function formatTick(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 9)}…`;
}

export function ChartArtifactPreview(props: {
  artifact: ArtifactLike;
  downloadHref: string;
}) {
  const [state, setState] = useState<ChartPreviewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const contentType = baseContentType(props.artifact.contentType);

    if (!["application/json", "text/plain"].includes(contentType)) {
      setState({
        status: "unsupported",
        message: "이 차트 아티팩트는 지원되는 안전 차트 스펙 형식을 사용하지 않습니다.",
      });
      return () => {
        cancelled = true;
      };
    }

    async function loadChart(): Promise<void> {
      try {
        const response = await fetch(props.downloadHref, {
          headers: {
            Accept: "application/json, text/plain; q=0.9",
          },
        });

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const payload = await response.text();
        const parsed = parseSupportedChartSpec(JSON.parse(payload));
        if (!parsed) {
          if (!cancelled) {
            setState({
              status: "unsupported",
              message: "지원되지 않는 차트 스펙입니다. 이 렌더러는 안전한 Vega-Lite 서브셋 또는 단순 시리즈 형식만 지원합니다.",
            });
          }
          return;
        }

        if (!cancelled) {
          setState({
            status: "ready",
            spec: parsed,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "차트 아티팩트를 불러오지 못했습니다.",
          });
        }
      }
    }

    void loadChart();

    return () => {
      cancelled = true;
    };
  }, [props.artifact.contentType, props.downloadHref]);

  const geometry = useMemo(
    () => (state.status === "ready" ? buildChartGeometry(state.spec) : null),
    [state]
  );

  if (state.status === "loading") {
    return (
      <div className="border-b border-border bg-muted px-4 py-6 text-sm leading-6 text-muted-foreground">
        안전 차트 미리보기 로딩 중...
      </div>
    );
  }

  if (state.status === "unsupported" || state.status === "error" || !geometry) {
    const message =
      state.status === "unsupported" || state.status === "error"
        ? state.message
        : "차트 지오메트리를 사용할 수 없습니다.";

    return (
      <div className="border-b border-border bg-muted px-4 py-6 text-sm leading-6 text-muted-foreground">
        <div className="font-medium text-foreground">차트 미리보기 불가</div>
        <div>{message}</div>
        <div className="mt-2 text-xs uppercase  text-muted-foreground">
          다운로드로 대체
        </div>
      </div>
    );
  }

  const baselineY = geometry.yScale(0);

  return (
    <div className="border-b border-border bg-muted px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase  text-muted-foreground">
        <span>안전 차트 렌더러</span>
        <span className="rounded-full bg-muted px-2 py-1 text-foreground">
          {state.spec.source === "vega-lite-subset" ? "Vega-Lite 서브셋" : "시리즈 스펙"}
        </span>
      </div>
      <div className="custom-scrollbar overflow-x-auto rounded-2xl border border-border bg-card shadow-inset-white">
        <svg
          viewBox={`0 0 ${CHART_FRAME_WIDTH} ${CHART_FRAME_HEIGHT}`}
          className="h-80 w-full min-w-112"
          role="img"
          aria-label={state.spec.title ?? props.artifact.name}
        >
          <rect width={CHART_FRAME_WIDTH} height={CHART_FRAME_HEIGHT} fill="#ffffff" />

          {geometry.yTicks.map((tick) => (
            <g key={`y-${tick.label}`}>
              <line
                x1={CHART_MARGIN.left}
                x2={CHART_FRAME_WIDTH - CHART_MARGIN.right}
                y1={tick.y}
                y2={tick.y}
                stroke="#e7e5e4"
                strokeWidth="1"
              />
              <text
                x={CHART_MARGIN.left - 10}
                y={tick.y}
                fill="#57534e"
                fontSize="11"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick.label}
              </text>
            </g>
          ))}

          <line
            x1={CHART_MARGIN.left}
            x2={CHART_FRAME_WIDTH - CHART_MARGIN.right}
            y1={baselineY}
            y2={baselineY}
            stroke="#a8a29e"
            strokeWidth="1.2"
          />

          {geometry.xTicks.map((tick) => (
            <g key={`x-${tick.label}`}>
              <line
                x1={tick.x}
                x2={tick.x}
                y1={CHART_MARGIN.top}
                y2={CHART_FRAME_HEIGHT - CHART_MARGIN.bottom}
                stroke="#f5f5f4"
                strokeWidth="1"
              />
              <text
                x={tick.x}
                y={CHART_FRAME_HEIGHT - CHART_MARGIN.bottom + 18}
                fill="#57534e"
                fontSize="11"
                textAnchor="middle"
              >
                {formatTick(String(tick.label))}
              </text>
            </g>
          ))}

          {state.spec.kind === "bar" && geometry.categories
            ? state.spec.series.flatMap((series, seriesIndex) => {
              const clusterWidth =
                geometry.categories && geometry.categories.length > 0
                  ? geometry.plotWidth / Math.max(geometry.categories.length, 1)
                  : geometry.plotWidth;
              const barWidth = Math.max(
                12,
                (clusterWidth * 0.7) / Math.max(state.spec.series.length, 1)
              );

              return series.points.map((point, pointIndex) => {
                const categoryIndex = geometry.categories?.indexOf(String(point.x)) ?? pointIndex;
                const centerX =
                  CHART_MARGIN.left +
                  (geometry.categories?.length === 1
                    ? geometry.plotWidth / 2
                    : (geometry.plotWidth / Math.max((geometry.categories?.length ?? 1) - 1, 1)) *
                      categoryIndex);
                const x =
                  centerX -
                  (barWidth * state.spec.series.length) / 2 +
                  seriesIndex * barWidth;
                const y = geometry.yScale(point.y);
                const height = Math.max(1, Math.abs(baselineY - y));
                const top = point.y >= 0 ? y : baselineY;

                return (
                  <rect
                    key={`${seriesIndex}-${pointIndex}`}
                    x={x}
                    y={top}
                    width={barWidth - 2}
                    height={height}
                    fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                    rx="3"
                  />
                );
              });
            })
            : state.spec.series.map((series, seriesIndex) => {
              const points = [...series.points]
                .sort((left, right) => {
                  if (typeof left.x === "number" && typeof right.x === "number") {
                    return left.x - right.x;
                  }
                  return String(left.x).localeCompare(String(right.x));
                })
                .map((point) => ({
                  x: geometry.xScale(point.x),
                  y: geometry.yScale(point.y),
                }));
              const stroke = CHART_COLORS[seriesIndex % CHART_COLORS.length];

              return (
                <g key={series.name ?? `series-${seriesIndex}`}>
                  {state.spec.kind === "area" ? (
                    <path d={buildAreaPath(points, baselineY)} fill={`${stroke}22`} />
                  ) : null}
                  <path
                    d={buildLinePath(points)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth="3"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {points.map((point, pointIndex) => (
                    <circle
                      key={`${seriesIndex}-${pointIndex}`}
                      cx={point.x}
                      cy={point.y}
                      r="4"
                      fill={stroke}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                  ))}
                </g>
              );
            })}

          {state.spec.title ? (
            <text
              x={CHART_FRAME_WIDTH / 2}
              y="18"
              fill="#1c1917"
              fontSize="15"
              fontWeight="600"
              textAnchor="middle"
            >
              {state.spec.title}
            </text>
          ) : null}

          {state.spec.xLabel ? (
            <text
              x={CHART_FRAME_WIDTH / 2}
              y={CHART_FRAME_HEIGHT - 12}
              fill="#57534e"
              fontSize="12"
              textAnchor="middle"
            >
              {state.spec.xLabel}
            </text>
          ) : null}

          {state.spec.yLabel ? (
            <text
              x="16"
              y={CHART_FRAME_HEIGHT / 2}
              fill="#57534e"
              fontSize="12"
              textAnchor="middle"
              transform={`rotate(-90 16 ${CHART_FRAME_HEIGHT / 2})`}
            >
              {state.spec.yLabel}
            </text>
          ) : null}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {state.spec.series.map((series, index) => (
          <div key={series.name ?? `legend-${index}`} className="inline-flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span>{series.name ?? `시리즈 ${index + 1}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
