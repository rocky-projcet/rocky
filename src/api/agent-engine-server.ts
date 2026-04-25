import Fastify, { type FastifyInstance } from "fastify";

import { AgentRegistryService } from "../agents/agent-registry-service.js";
import { ClaudeAccountService } from "../account/claude-account-service.js";
import { ClaudeStatusService } from "../account/claude-status-service.js";
import { CodexAccountService } from "../account/codex-account-service.js";
import { CodexStatusService } from "../account/codex-status-service.js";
import { AuthProfileService } from "../auth/auth-profile-service.js";
import { AgentMessengerService } from "../messenger/agent-messenger-service.js";
import type { AgentMessengerServiceLike } from "../messenger/messenger-types.js";
import { RockyChatService } from "../rocky-chat/rocky-chat-service.js";
import { SessionService } from "../sessions/session-service.js";
import { TaskService } from "../tasks/task-service.js";
import { createDefaultRuntimeRegistry } from "../runtime/runtime-registry.js";

import type { AgentRegistryServiceOptions } from "../agents/agent-types.js";
import type { AgentEngineServerOptions } from "./api-types.js";
import { registerApiErrorHandlers } from "./http/error-handler.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { registerAccountRoutes } from "./routes/account-routes.js";
import { registerAuthProfileRoutes } from "./routes/auth-profile-routes.js";
import { registerMessengerRoutes } from "./routes/messenger-routes.js";
import { registerRunRoutes } from "./routes/run-routes.js";
import { registerRuntimeRoutes } from "./routes/runtime-routes.js";
import { registerRockyChatRoutes } from "./routes/rocky-chat-routes.js";
import { registerSessionRoutes } from "./routes/session-routes.js";
import { registerTaskRoutes } from "./routes/task-routes.js";
import { SystemHardwareStatusService } from "../system/hardware-status-service.js";

export function createAgentEngineServer(
  options: AgentEngineServerOptions = {}
): FastifyInstance {
  const agentService =
    options.agentService ??
    new AgentRegistryService({
      stateRoot: options.stateRoot,
      manager: options.manager,
      now: options.now,
      idGenerator: options.idGenerator,
    });
  const authProfileService =
    options.authProfileService ??
    new AuthProfileService({
      stateRoot: options.stateRoot,
      now: options.now,
      idGenerator: options.idGenerator,
    });
  const codexAccountService =
    options.codexAccountService ??
    new CodexAccountService();
  const codexStatusService =
    options.codexStatusService ??
    new CodexStatusService({
      accountService: codexAccountService,
    });
  const claudeAccountService =
    options.claudeAccountService ??
    new ClaudeAccountService();
  const claudeStatusService =
    options.claudeStatusService ??
    new ClaudeStatusService({
      accountService: claudeAccountService,
      stateRoot: options.stateRoot,
    });
  const runtimeRegistry =
    options.runtimeRegistry ?? createDefaultRuntimeRegistry(process.env);
  const sessionService =
    options.sessionService ??
    new SessionService({
      stateRoot: options.stateRoot,
      runtimeRegistry,
      manager: options.manager as AgentRegistryServiceOptions["manager"],
      authProfiles: authProfileService,
      now: options.now,
      idGenerator: options.idGenerator,
    });
  const agentMessengerService: AgentMessengerServiceLike =
    options.agentMessengerService ??
    new AgentMessengerService({
      stateRoot: options.stateRoot,
      sessionService,
      now: options.now,
    });
  const taskService =
    options.taskService ??
    new TaskService({
      stateRoot: options.stateRoot,
      sessionService,
      manager: options.manager as AgentRegistryServiceOptions["manager"],
      messengerService: agentMessengerService,
      now: options.now,
      idGenerator: options.idGenerator,
    });
  const rockyChatService =
    options.rockyChatService ??
    new RockyChatService({
      stateRoot: options.stateRoot,
      agentService,
      sessionService,
      now: options.now,
      idGenerator: options.idGenerator,
    });
  const hardwareStatusService =
    options.hardwareStatusService ??
    new SystemHardwareStatusService();

  const server = Fastify({
    logger: false,
  });

  server.register(registerAgentRoutes, {
    agentService,
    sessionService,
    nativeFileOpener: options.nativeFileOpener,
  });
  server.register(registerAccountRoutes, {
    codexAccountService,
    codexStatusService,
    claudeAccountService,
    claudeStatusService,
    hardwareStatusService,
    now: options.now,
  });
  server.register(registerAuthProfileRoutes, {
    authProfileService,
  });
  server.register(registerSessionRoutes, {
    sessionService,
  });
  server.register(registerRunRoutes, {
    sessionService,
    nativeFileOpener: options.nativeFileOpener,
  });
  server.register(registerMessengerRoutes, {
    agentMessengerService,
  });
  server.register(registerRuntimeRoutes, {
    runtimeRegistry,
  });
  server.register(registerTaskRoutes, {
    taskService,
  });
  server.register(registerRockyChatRoutes, {
    rockyChatService,
  });
  server.addHook("onReady", async () => {
    await agentMessengerService?.start?.();
    await taskService.start?.();
  });
  server.addHook("onClose", async () => {
    await agentMessengerService?.close?.();
    await taskService.close?.();
  });
  registerApiErrorHandlers(server);

  return server;
}
