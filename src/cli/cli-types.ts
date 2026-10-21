import type {
  AgentCreateInput,
  AgentRecord,
  AgentRegistryServiceOptions,
  AgentUpdatePatch,
} from "../agents/agent-types.js";
import type { AgentServiceLike as HttpAgentServiceLike } from "../api/api-types.js";

export type OutputWriter = {
  write(chunk: string): unknown;
};

export interface CliAgentServiceLike extends HttpAgentServiceLike {
  createAgent(input?: AgentCreateInput): Promise<AgentRecord>;
  updateAgent(agentId: string, patch?: AgentUpdatePatch): Promise<AgentRecord>;
}

export interface CliDependencies extends AgentRegistryServiceOptions {
  stdout?: OutputWriter;
  stderr?: OutputWriter;
  service?: CliAgentServiceLike;
}

export interface CliOptionValues {
  "state-root"?: string;
  host?: string;
  port?: string;
  id?: string;
  name?: string;
  description?: string;
  "workspace-root"?: string;
  "runtime-home"?: string;
  sandbox?: string;
  approval?: string;
  "model-profile"?: string;
  status?: string;
  uv?: boolean;
  help?: boolean;
}

export type CliResource = "serve" | "agent";

export interface CliContext {
  values: CliOptionValues;
  stdout: OutputWriter;
  stderr: OutputWriter;
  service: CliAgentServiceLike;
  dependencies: CliDependencies;
}
