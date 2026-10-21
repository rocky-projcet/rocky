import { AgentManager } from "./agent-manager.js";

import type {
  AgentCreateInput,
  AgentRecord,
  AgentRegistryServiceOptions,
  AgentUpdatePatch,
} from "./agent-types.js";

export class AgentRegistryService {
  private readonly manager;

  constructor(options: AgentRegistryServiceOptions = {}) {
    this.manager = options.manager ?? new AgentManager(options);
  }

  async createAgent(input: AgentCreateInput = {}): Promise<AgentRecord> {
    return this.manager.createAgent(input);
  }

  async getAgent(agentId: string): Promise<AgentRecord> {
    return this.manager.getAgent(agentId);
  }

  async listAgents(): Promise<AgentRecord[]> {
    return this.manager.listAgents();
  }

  async updateAgent(
    agentId: string,
    patch: AgentUpdatePatch = {}
  ): Promise<AgentRecord> {
    return this.manager.updateAgent(agentId, patch);
  }

  async deleteAgent(agentId: string): Promise<void> {
    return this.manager.deleteAgent(agentId);
  }
}
