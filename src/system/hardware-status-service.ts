import os from "node:os";
import { execFile as rawExecFile } from "node:child_process";
import { statfs } from "node:fs/promises";

import type {
  HardwareCpuRecord,
  HardwareGpuRecord,
  HardwareMemoryKind,
  HardwareStatusRecord,
  HardwareStatusServiceLike,
} from "./hardware-status-types.js";

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

type ExecFileLike = (
  file: string,
  args?: readonly string[],
  options?: {
    timeout?: number;
    maxBuffer?: number;
  }
) => Promise<ExecFileResult>;

interface CpuSample {
  takenAt: number;
  idle: number;
  total: number;
  logicalCores: number;
  model: string | null;
  speedGHz: number | null;
}

interface DarwinHardwareSnapshot {
  gpus: HardwareGpuRecord[];
}

interface SystemHardwareStatusServiceOptions {
  now?: () => string;
  targetPath?: string;
  execFile?: ExecFileLike;
  hostname?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

function execFile(
  file: string,
  args: readonly string[] = [],
  options: {
    timeout?: number;
    maxBuffer?: number;
  } = {}
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    rawExecFile(
      file,
      [...args],
      {
        encoding: "utf8",
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          stdout,
          stderr,
        });
      }
    );
  });
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, roundToSingleDecimal(value)));
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHumanSizeToBytes(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, "").trim().toUpperCase();
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*([KMGTPE]?)(?:I?B|B)?/);
  if (!match) {
    return null;
  }

  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount)) {
    return null;
  }

  const unit = match[2] ?? "";
  const exponentByUnit: Record<string, number> = {
    "": 0,
    K: 1,
    M: 2,
    G: 3,
    T: 4,
    P: 5,
    E: 6,
  };
  const exponent = exponentByUnit[unit] ?? 0;
  return Math.round(amount * 1024 ** exponent);
}

function parseSwapUsage(value: string | null | undefined): {
  totalBytes: number | null;
  usedBytes: number | null;
} {
  if (!value) {
    return {
      totalBytes: null,
      usedBytes: null,
    };
  }

  const totalMatch = value.match(/total\s*=\s*([0-9.]+\s*[KMGTPE]?B?)/i);
  const usedMatch = value.match(/used\s*=\s*([0-9.]+\s*[KMGTPE]?B?)/i);
  return {
    totalBytes: parseHumanSizeToBytes(totalMatch?.[1]),
    usedBytes: parseHumanSizeToBytes(usedMatch?.[1]),
  };
}

function resolveVendor(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (value.startsWith("sppci_vendor_")) {
    return value.slice("sppci_vendor_".length);
  }

  return value;
}

function fallbackDarwinGpu(
  totalMemoryBytes: number,
  cpuModel: string | null
): HardwareGpuRecord[] {
  return [
    {
      name: cpuModel,
      vendor: cpuModel?.startsWith("Apple") ? "Apple" : null,
      coreCount: null,
      memoryKind: "unified",
      memoryBytes: totalMemoryBytes,
      utilizationPercent: null,
      note: "macOS는 CPU와 GPU가 통합 메모리를 공유합니다.",
    },
  ];
}

export class SystemHardwareStatusService implements HardwareStatusServiceLike {
  private readonly now: () => string;
  private readonly targetPath: string;
  private readonly execFile: ExecFileLike;
  private readonly hostname: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;

  private lastCpuSample: CpuSample;
  private cachedDarwinSnapshot:
    | {
        expiresAt: number;
        value: DarwinHardwareSnapshot;
      }
    | null = null;

  constructor(options: SystemHardwareStatusServiceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.targetPath = options.targetPath ?? os.homedir();
    this.execFile = options.execFile ?? execFile;
    this.hostname = options.hostname ?? os.hostname();
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.lastCpuSample = this.captureCpuSample();
  }

  async getStatus(): Promise<HardwareStatusRecord> {
    const currentCpuSample = this.captureCpuSample();
    const memoryKind: HardwareMemoryKind =
      this.platform === "darwin" ? "unified" : "ram";
    const cpu = this.buildCpuRecord(currentCpuSample);
    const memory = await this.readMemoryRecord(memoryKind);
    const gpus = await this.readGpuRecords(memory.totalBytes, currentCpuSample.model);
    const storage = await this.readStorageRecord();

    this.lastCpuSample = currentCpuSample;

    return {
      hostname: this.hostname,
      platform: this.platform,
      arch: this.arch,
      refreshedAt: this.now(),
      cpu,
      memory,
      gpus,
      storage,
    };
  }

  private captureCpuSample(): CpuSample {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total +=
        cpu.times.user +
        cpu.times.nice +
        cpu.times.sys +
        cpu.times.idle +
        cpu.times.irq;
    }

    const model = cpus[0]?.model?.trim() || null;
    const speedMHz = cpus[0]?.speed ?? null;
    return {
      takenAt: Date.now(),
      idle,
      total,
      logicalCores: cpus.length || os.availableParallelism(),
      model,
      speedGHz:
        typeof speedMHz === "number" && speedMHz > 0
          ? roundToSingleDecimal(speedMHz / 1000)
          : null,
    };
  }

  private buildCpuRecord(sample: CpuSample): HardwareCpuRecord {
    const loadAverage = os.loadavg();
    const previous = this.lastCpuSample;
    let usagePercent: number | null = null;

    const totalDelta = sample.total - previous.total;
    const idleDelta = sample.idle - previous.idle;
    if (totalDelta > 0) {
      usagePercent = clampPercent(((totalDelta - idleDelta) / totalDelta) * 100);
    }

    const normalizedLoadPercent =
      sample.logicalCores > 0 && loadAverage[0] !== undefined
        ? clampPercent((loadAverage[0] / sample.logicalCores) * 100)
        : null;

    return {
      model: sample.model,
      physicalCores: null,
      logicalCores: sample.logicalCores,
      speedGHz: sample.speedGHz,
      usagePercent,
      normalizedLoadPercent,
      loadAverage: {
        oneMinute:
          typeof loadAverage[0] === "number" ? roundToSingleDecimal(loadAverage[0]) : null,
        fiveMinute:
          typeof loadAverage[1] === "number" ? roundToSingleDecimal(loadAverage[1]) : null,
        fifteenMinute:
          typeof loadAverage[2] === "number" ? roundToSingleDecimal(loadAverage[2]) : null,
      },
    };
  }

  private async readMemoryRecord(kind: HardwareMemoryKind) {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = Math.max(totalBytes - freeBytes, 0);
    const swapUsage = await this.readSwapUsage();

    return {
      kind,
      totalBytes,
      usedBytes,
      freeBytes,
      availableBytes: freeBytes,
      usedPercent:
        totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : 0,
      swapTotalBytes: swapUsage.totalBytes,
      swapUsedBytes: swapUsage.usedBytes,
    };
  }

  private async readSwapUsage(): Promise<{
    totalBytes: number | null;
    usedBytes: number | null;
  }> {
    if (this.platform !== "darwin") {
      return {
        totalBytes: null,
        usedBytes: null,
      };
    }

    try {
      const { stdout } = await this.execFile("sysctl", ["vm.swapusage"], {
        timeout: 1500,
        maxBuffer: 1024 * 32,
      });
      return parseSwapUsage(stdout);
    } catch {
      return {
        totalBytes: null,
        usedBytes: null,
      };
    }
  }

  private async readStorageRecord() {
    try {
      const stats = await statfs(this.targetPath);
      const totalBytes = stats.bsize * stats.blocks;
      const availableBytes = stats.bsize * stats.bavail;
      const usedBytes = Math.max(totalBytes - availableBytes, 0);

      return {
        path: this.targetPath,
        totalBytes,
        usedBytes,
        availableBytes,
        usedPercent:
          totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : null,
      };
    } catch {
      return {
        path: this.targetPath,
        totalBytes: null,
        usedBytes: null,
        availableBytes: null,
        usedPercent: null,
      };
    }
  }

  private async readGpuRecords(
    totalMemoryBytes: number,
    cpuModel: string | null
  ): Promise<HardwareGpuRecord[]> {
    if (this.platform === "darwin") {
      const snapshot = await this.readDarwinHardwareSnapshot(totalMemoryBytes, cpuModel);
      return snapshot.gpus.length > 0
        ? snapshot.gpus
        : fallbackDarwinGpu(totalMemoryBytes, cpuModel);
    }

    const nvidia = await this.readNvidiaGpuRecords();
    return nvidia;
  }

  private async readDarwinHardwareSnapshot(
    totalMemoryBytes: number,
    cpuModel: string | null
  ): Promise<DarwinHardwareSnapshot> {
    const now = Date.now();
    if (this.cachedDarwinSnapshot && this.cachedDarwinSnapshot.expiresAt > now) {
      return this.cachedDarwinSnapshot.value;
    }

    let snapshot: DarwinHardwareSnapshot = {
      gpus: [],
    };

    try {
      const { stdout } = await this.execFile(
        "system_profiler",
        ["SPDisplaysDataType", "-json", "-detailLevel", "mini"],
        {
          timeout: 5000,
          maxBuffer: 1024 * 1024 * 4,
        }
      );
      const parsed = JSON.parse(stdout) as {
        SPDisplaysDataType?: Array<Record<string, unknown>>;
      };

      const gpus = (parsed.SPDisplaysDataType ?? [])
        .map((entry) => this.parseDarwinGpuRecord(entry, totalMemoryBytes, cpuModel))
        .filter((entry): entry is HardwareGpuRecord => Boolean(entry));

      snapshot = {
        gpus,
      };
    } catch {
      snapshot = {
        gpus: [],
      };
    }

    this.cachedDarwinSnapshot = {
      value: snapshot,
      expiresAt: now + 5 * 60_000,
    };
    return snapshot;
  }

  private parseDarwinGpuRecord(
    entry: Record<string, unknown>,
    totalMemoryBytes: number,
    cpuModel: string | null
  ): HardwareGpuRecord | null {
    const name =
      (typeof entry.sppci_model === "string" && entry.sppci_model.trim()) ||
      (typeof entry._name === "string" && entry._name.trim()) ||
      cpuModel;

    if (!name) {
      return null;
    }

    const vendor =
      resolveVendor(
        typeof entry.spdisplays_vendor === "string"
          ? entry.spdisplays_vendor
          : null
      ) ?? (name.startsWith("Apple") ? "Apple" : null);
    const coreCount = parseNumber(entry.sppci_cores);
    const memoryText =
      (typeof entry.spdisplays_vram_shared === "string" && entry.spdisplays_vram_shared) ||
      (typeof entry.spdisplays_vram === "string" && entry.spdisplays_vram) ||
      null;
    const memoryKind =
      typeof entry.spdisplays_vram_shared === "string" || name.startsWith("Apple")
        ? "unified"
        : memoryText
          ? "dedicated"
          : "unknown";
    const memoryBytes =
      parseHumanSizeToBytes(memoryText) ??
      (memoryKind === "unified" ? totalMemoryBytes : null);

    const noteParts: string[] = [];
    if (coreCount !== null) {
      noteParts.push(`GPU 코어 ${coreCount}개`);
    }
    if (memoryKind === "unified") {
      noteParts.push("CPU와 GPU가 통합 메모리를 공유합니다.");
    }

    return {
      name,
      vendor,
      coreCount,
      memoryKind,
      memoryBytes,
      utilizationPercent: null,
      note: noteParts.length > 0 ? noteParts.join(" · ") : null,
    };
  }

  private async readNvidiaGpuRecords(): Promise<HardwareGpuRecord[]> {
    try {
      const { stdout } = await this.execFile(
        "nvidia-smi",
        [
          "--query-gpu=name,memory.total,utilization.gpu",
          "--format=csv,noheader,nounits",
        ],
        {
          timeout: 2000,
          maxBuffer: 1024 * 128,
        }
      );

      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [nameRaw, memoryRaw, utilizationRaw] = line.split(",").map((value) => value.trim());
          const memoryMiB = parseNumber(memoryRaw);
          const utilization = parseNumber(utilizationRaw);

          return {
            name: nameRaw || null,
            vendor: "NVIDIA",
            coreCount: null,
            memoryKind: "dedicated" as const,
            memoryBytes:
              memoryMiB !== null ? Math.round(memoryMiB * 1024 * 1024) : null,
            utilizationPercent:
              utilization !== null ? clampPercent(utilization) : null,
            note: null,
          };
        });
    } catch {
      return [];
    }
  }
}
