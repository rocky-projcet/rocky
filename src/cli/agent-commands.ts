import type { AgentUpdatePatch } from "../agents/agent-types.js";
import type { CliContext } from "./cli-types.js";
import {
  compactAgentUpdatePatch,
  unknownCommandError,
  usageError,
  writeJson,
} from "./cli-helpers.js";

export async function handleAgentCommand(
  command: string | undefined,
  targetId: string | undefined,
  context: CliContext
): Promise<number> {
  if (command === "create") {
    const created = await context.service.createAgent({
      id: context.values.id,
      name: context.values.name,
      description: context.values.description,
      workspaceRoot: context.values["workspace-root"],
      runtimeHome: context.values["runtime-home"],
      sandboxPolicy: context.values.sandbox,
      approvalPolicy: context.values.approval,
      modelProfile: context.values["model-profile"],
      status: context.values.status,
      bootstrapUvVenv: context.values.uv ?? false,
    });
    writeJson(context.stdout, created);
    return 0;
  }

  if (command === "list") {
    writeJson(context.stdout, await context.service.listAgents());
    return 0;
  }

  if (command === "update") {
    if (!targetId) {
      return usageError(context.stderr, "agent update requires <agent-id>");
    }

    const updated = await context.service.updateAgent(
      targetId,
      compactAgentUpdatePatch({
        name: context.values.name,
        description: context.values.description,
        workspaceRoot: context.values["workspace-root"],
        runtimeHome: context.values["runtime-home"],
          sandboxPolicy: context.values.sandbox,
        approvalPolicy: context.values.approval,
        modelProfile: context.values["model-profile"],
        status: context.values.status,
        bootstrapUvVenv: context.values.uv,
      } satisfies AgentUpdatePatch)
    );
    writeJson(context.stdout, updated);
    return 0;
  }

  return unknownCommandError(context.stderr, command);
}
