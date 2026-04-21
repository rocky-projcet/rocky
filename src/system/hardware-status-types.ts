export type HardwareMemoryKind = "ram" | "unified";
export type HardwareGpuMemoryKind =
  | "dedicated"
  | "integrated"
  | "shared"
  | "unified"
  | "unknown";

export interface HardwareCpuRecord {
  model: string | null;
  physicalCores: number | null;
  logicalCores: number;
  speedGHz: number | null;
  usagePercent: number | null;
  normalizedLoadPercent: number | null;
  loadAverage: {
    oneMinute: number | null;
    fiveMinute: number | null;
    fifteenMinute: number | null;
  };
}

export interface HardwareMemoryRecord {
  kind: HardwareMemoryKind;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
  usedPercent: number;
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;
}

export interface HardwareGpuRecord {
  name: string | null;
  vendor: string | null;
  coreCount: number | null;
  memoryKind: HardwareGpuMemoryKind;
  memoryBytes: number | null;
  utilizationPercent: number | null;
  note: string | null;
}

export interface HardwareStorageRecord {
  path: string;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
}

export interface HardwareStatusRecord {
  hostname: string;
  platform: NodeJS.Platform | string;
  arch: string;
  refreshedAt: string;
  cpu: HardwareCpuRecord;
  memory: HardwareMemoryRecord;
  gpus: HardwareGpuRecord[];
  storage: HardwareStorageRecord;
}

export interface HardwareStatusServiceLike {
  getStatus(): Promise<HardwareStatusRecord>;
}
