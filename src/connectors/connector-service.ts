import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getConnectorAdapter, listSupportedProviders } from "./adapters.js";
import {
  detectChromium,
  startHeadedLogin,
  type ConnectorRunnerSession,
} from "./connector-runner.js";
import {
  type ChromiumChannel,
  type ConnectorDiagnosticsRecord,
  type ConnectorProvider,
  type ConnectorServiceLike,
  type ConnectorState,
  type ConnectorStatus,
} from "./connector-types.js";

export interface ConnectorServiceOptions {
  stateRoot?: string;
  now?: () => string;
}

interface ActiveSession {
  provider: ConnectorProvider;
  session: ConnectorRunnerSession;
}

const DIAGNOSTICS_TTL_MS = 60_000;

export class ConnectorService implements ConnectorServiceLike {
  private readonly stateRoot: string;
  private readonly now: () => string;
  private states: Record<ConnectorProvider, ConnectorState>;
  private active: ActiveSession | null = null;
  private cachedDiagnostics: ConnectorDiagnosticsRecord | null = null;
  private diagnosticsCheckedAt = 0;

  constructor(options: ConnectorServiceOptions = {}) {
    this.stateRoot = options.stateRoot ?? path.resolve(".runtime", "agent-engine");
    this.now = options.now ?? (() => new Date().toISOString());
    this.states = listSupportedProviders().reduce(
      (acc, provider) => {
        acc[provider] = buildIdleState(provider, this.now());
        return acc;
      },
      {} as Record<ConnectorProvider, ConnectorState>,
    );
    void this.hydrateFromDisk();
  }

  async getState(provider: ConnectorProvider): Promise<ConnectorState> {
    this.assertSupported(provider);
    return { ...this.states[provider] };
  }

  async startLogin(provider: ConnectorProvider): Promise<ConnectorState> {
    this.assertSupported(provider);

    const diagnostics = await this.getDiagnostics();
    if (!diagnostics.available || !diagnostics.channel) {
      this.transition(provider, {
        status: "failed",
        message: "헤드리스 브라우저를 찾지 못했습니다.",
        lastError: diagnostics.message,
      });
      return { ...this.states[provider] };
    }

    if (this.active) {
      try {
        await this.active.session.cancel();
      } catch {
        // ignore
      }
      this.active = null;
    }

    const adapter = getConnectorAdapter(provider);
    this.transition(provider, {
      status: "connecting",
      message: `${adapter.label} 로그인 창을 여는 중…`,
      lastError: null,
    });

    try {
      const session = await startHeadedLogin({
        adapter,
        channel: diagnostics.channel,
        onEvent: (event) => {
          if (event.kind === "connected") {
            void this.handleConnected(
              provider,
              event.accountLabel,
              event.storageStateJson,
            ).catch((error) => {
              this.transition(provider, {
                status: "failed",
                message: "연동 결과를 저장하지 못했습니다.",
                lastError:
                  error instanceof Error ? error.message : String(error),
              });
              this.active = null;
            });
            return;
          }
          if (event.kind === "failed") {
            this.transition(provider, {
              status: "failed",
              message: "연동에 실패했습니다.",
              lastError: event.message,
            });
            this.active = null;
          }
        },
      });
      this.active = { provider, session };
      this.transition(provider, {
        status: "connecting",
        message: `${adapter.label} 창에서 로그인을 진행해 주세요. 완료되면 자동으로 닫혀요.`,
        lastError: null,
      });
    } catch (error) {
      this.transition(provider, {
        status: "failed",
        message: "로그인 창을 열지 못했습니다.",
        lastError: error instanceof Error ? error.message : String(error),
      });
      this.active = null;
    }

    return { ...this.states[provider] };
  }

  async cancelLogin(provider: ConnectorProvider): Promise<ConnectorState> {
    this.assertSupported(provider);
    if (this.active && this.active.provider === provider) {
      try {
        await this.active.session.cancel();
      } catch {
        // ignore
      }
      this.active = null;
    }
    if (this.states[provider].status === "connecting") {
      this.transition(provider, {
        status: "idle",
        message: "연동을 취소했어요.",
        lastError: null,
      });
    }
    return { ...this.states[provider] };
  }

  async disconnect(provider: ConnectorProvider): Promise<ConnectorState> {
    this.assertSupported(provider);
    if (this.active?.provider === provider) {
      try {
        await this.active.session.cancel();
      } catch {
        // ignore
      }
      this.active = null;
    }
    await this.removeStorage(provider);
    this.transition(provider, {
      status: "idle",
      message: "연결이 해제되었습니다.",
      accountLabel: null,
      connectedAt: null,
      lastError: null,
    });
    return { ...this.states[provider] };
  }

  async getDiagnostics(): Promise<ConnectorDiagnosticsRecord> {
    const now = Date.now();
    if (
      this.cachedDiagnostics &&
      now - this.diagnosticsCheckedAt < DIAGNOSTICS_TTL_MS
    ) {
      return { ...this.cachedDiagnostics };
    }
    const result = await detectChromium();
    const record: ConnectorDiagnosticsRecord = {
      ...result,
      checkedAt: this.now(),
    };
    this.cachedDiagnostics = record;
    this.diagnosticsCheckedAt = now;
    return { ...record };
  }

  private async handleConnected(
    provider: ConnectorProvider,
    accountLabel: string,
    storageStateJson: string,
  ): Promise<void> {
    await this.persistStorage(provider, storageStateJson);
    this.transition(provider, {
      status: "connected",
      message: "연동이 완료되었습니다.",
      accountLabel,
      connectedAt: this.now(),
      lastError: null,
    });
    this.active = null;
  }

  private async persistStorage(
    provider: ConnectorProvider,
    storageStateJson: string,
  ): Promise<void> {
    const dir = this.providerDir(provider);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, "storage.json"), storageStateJson, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  private async removeStorage(provider: ConnectorProvider): Promise<void> {
    const dir = this.providerDir(provider);
    await rm(dir, { recursive: true, force: true });
  }

  private async hydrateFromDisk(): Promise<void> {
    for (const provider of listSupportedProviders()) {
      const storagePath = path.join(this.providerDir(provider), "storage.json");
      try {
        const raw = await readFile(storagePath, "utf8");
        if (raw.trim()) {
          this.transition(provider, {
            status: "connected",
            message: "이전 세션이 복원되었습니다.",
            lastError: null,
          });
        }
      } catch {
        // No stored session for this provider.
      }
    }
  }

  private providerDir(provider: ConnectorProvider): string {
    return path.join(this.stateRoot, "connectors", provider);
  }

  private transition(
    provider: ConnectorProvider,
    patch: Partial<Omit<ConnectorState, "provider" | "updatedAt">> & {
      status: ConnectorStatus;
    },
  ): void {
    const prev = this.states[provider];
    this.states[provider] = {
      ...prev,
      ...patch,
      provider,
      updatedAt: this.now(),
    };
  }

  private assertSupported(provider: ConnectorProvider): void {
    if (!listSupportedProviders().includes(provider)) {
      throw Object.assign(new Error(`지원하지 않는 커넥터입니다: ${provider}`), {
        statusCode: 400,
      });
    }
  }
}

function buildIdleState(provider: ConnectorProvider, now: string): ConnectorState {
  return {
    provider,
    status: "idle",
    message: "연동되지 않음",
    accountLabel: null,
    connectedAt: null,
    lastError: null,
    updatedAt: now,
  };
}

// Re-export channel type for callers that need to inspect diagnostics.
export type { ChromiumChannel };
