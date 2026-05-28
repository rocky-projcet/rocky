import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import { listSupportedProviders } from "../../connectors/adapters.js";
import type {
  ConnectorBrokerRedeemInput,
  ConnectorBrokerStartInput,
  ConnectorExecuteCapabilityInput,
  ConnectorOAuthSettingsInput,
  ConnectorPublishDraftInput,
  ConnectorProvider,
  ConnectorServiceLike,
  ConnectorStartLoginInput,
  ConnectorTesterRequestInput,
  ConnectorTesterRequestStatus,
} from "../../connectors/connector-types.js";
import { sendJson } from "../http/reply.js";

interface ConnectorRoutesOptions extends FastifyPluginOptions {
  connectorService: ConnectorServiceLike;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function parseProvider(raw: string): ConnectorProvider {
  if (!listSupportedProviders().includes(raw as ConnectorProvider)) {
    throw badRequest(`지원하지 않는 커넥터입니다: ${raw}`);
  }
  return raw as ConnectorProvider;
}

function parsePublishDraftBody(body: unknown): ConnectorPublishDraftInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("커넥터 발행 요청은 JSON object여야 합니다.");
  }

  const input = body as Record<string, unknown>;
  if (typeof input.title !== "string" || !input.title.trim()) {
    throw badRequest("커넥터 발행 요청에는 title이 필요합니다.");
  }
  if (
    typeof input.contentMarkdown !== "string" ||
    !input.contentMarkdown.trim()
  ) {
    throw badRequest("커넥터 발행 요청에는 contentMarkdown이 필요합니다.");
  }
  if (
    input.visibility !== undefined &&
    input.visibility !== "draft" &&
    input.visibility !== "private" &&
    input.visibility !== "public"
  ) {
    throw badRequest("visibility는 draft, private, public 중 하나여야 합니다.");
  }

  return {
    title: input.title.trim(),
    contentMarkdown: input.contentMarkdown.trim(),
    tags: Array.isArray(input.tags)
      ? input.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    visibility:
      input.visibility === "draft" ||
      input.visibility === "private" ||
      input.visibility === "public"
        ? input.visibility
        : undefined,
  };
}

function parseExecuteCapabilityBody(
  capabilityId: string,
  body: unknown,
): ConnectorExecuteCapabilityInput {
  if (body === undefined || body === null) {
    return { capabilityId };
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("커넥터 capability 실행 요청은 JSON object여야 합니다.");
  }

  const input = body as Record<string, unknown>;
  const args = input.args;
  if (args === undefined || args === null) {
    return { capabilityId };
  }
  if (typeof args !== "object" || Array.isArray(args)) {
    throw badRequest("커넥터 capability 실행 args는 JSON object여야 합니다.");
  }
  return { capabilityId, args: args as Record<string, unknown> };
}

function parseBrokerStartBody(body: unknown): ConnectorBrokerStartInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("OAuth broker start 요청은 JSON object여야 합니다.");
  }
  const input = body as Record<string, unknown>;
  if (typeof input.returnUrl !== "string" || !input.returnUrl.trim()) {
    throw badRequest("OAuth broker start 요청에는 returnUrl이 필요합니다.");
  }
  return {
    returnUrl: input.returnUrl.trim(),
    brokerBaseUrl:
      typeof input.brokerBaseUrl === "string" && input.brokerBaseUrl.trim()
        ? input.brokerBaseUrl.trim()
        : null,
  };
}

function parseBrokerRedeemBody(body: unknown): ConnectorBrokerRedeemInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("OAuth broker redeem 요청은 JSON object여야 합니다.");
  }
  const input = body as Record<string, unknown>;
  if (typeof input.handoffCode !== "string" || !input.handoffCode.trim()) {
    throw badRequest("OAuth broker redeem 요청에는 handoffCode가 필요합니다.");
  }
  return { handoffCode: input.handoffCode.trim() };
}

function parseStartLoginBody(
  body: unknown,
): Pick<ConnectorStartLoginInput, "openExternal"> {
  if (body === undefined || body === null) {
    return {};
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("커넥터 로그인 요청은 JSON object여야 합니다.");
  }
  const input = body as Record<string, unknown>;
  if (input.openExternal === undefined || input.openExternal === null) {
    return {};
  }
  if (typeof input.openExternal !== "boolean") {
    throw badRequest("openExternal은 boolean이어야 합니다.");
  }
  return { openExternal: input.openExternal };
}

function parseOAuthSettingsBody(body: unknown): ConnectorOAuthSettingsInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("커넥터 OAuth 설정은 JSON object여야 합니다.");
  }
  const input = body as Record<string, unknown>;
  return {
    clientId: requiredOAuthSetting(input, "clientId"),
    clientSecret: requiredOAuthSetting(input, "clientSecret"),
    redirectUri: optionalOAuthSetting(input, "redirectUri"),
  };
}

function requiredOAuthSetting(
  input: Record<string, unknown>,
  key: "clientId" | "clientSecret",
): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`커넥터 OAuth 설정에는 ${key}이 필요합니다.`);
  }
  return value.trim();
}

function optionalOAuthSetting(
  input: Record<string, unknown>,
  key: "redirectUri",
): string | null {
  const value = input[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw badRequest(`커넥터 OAuth 설정 ${key}은 string이어야 합니다.`);
  }
  return value.trim() || null;
}

function parseTesterRequestBody(body: unknown): ConnectorTesterRequestInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("테스터 등록 요청은 JSON object여야 합니다.");
  }
  const input = body as Record<string, unknown>;
  if (
    typeof input.accountIdentifier !== "string" ||
    !input.accountIdentifier.trim()
  ) {
    throw badRequest("테스터 등록 요청에는 Instagram 계정 식별자가 필요합니다.");
  }
  const status = parseTesterRequestStatus(input.status);
  return {
    accountIdentifier: input.accountIdentifier.trim(),
    ...(status ? { status } : {}),
  };
}

function parseTesterRequestStatus(
  value: unknown,
): ConnectorTesterRequestStatus | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (value === "pending" || value === "invited" || value === "accepted") {
    return value;
  }
  throw badRequest("테스터 등록 상태는 pending, invited, accepted 중 하나여야 합니다.");
}

export const registerConnectorRoutes: FastifyPluginAsync<
  ConnectorRoutesOptions
> = async (server, options) => {
  server.get("/connectors/diagnostics", async (_request, reply) => {
    sendJson(reply, 200, await options.connectorService.getDiagnostics());
  });

  server.get("/connectors/:provider/state", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(reply, 200, await options.connectorService.getState(parsed));
  });

  server.get("/connectors/:provider/oauth-settings", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(reply, 200, await options.connectorService.getOAuthSettings(parsed));
  });

  server.put("/connectors/:provider/oauth-settings", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(
      reply,
      200,
      await options.connectorService.saveOAuthSettings(
        parsed,
        parseOAuthSettingsBody(request.body),
      ),
    );
  });

  server.delete("/connectors/:provider/oauth-settings", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(reply, 200, await options.connectorService.deleteOAuthSettings(parsed));
  });

  server.post("/connectors/:provider/login", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(
      reply,
      202,
      await options.connectorService.startLogin(parsed, {
        redirectBaseUrl: resolveRequestBaseUrl(request),
        ...parseStartLoginBody(request.body),
      }),
    );
  });

  server.post("/connectors/:provider/graph-discovery", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(
      reply,
      202,
      await options.connectorService.startGraphDiscovery(parsed, {
        redirectBaseUrl: resolveRequestBaseUrl(request),
        ...parseStartLoginBody(request.body),
      }),
    );
  });

  server.post("/connectors/:provider/tester-request", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(
      reply,
      200,
      await options.connectorService.requestTesterRegistration(
        parsed,
        parseTesterRequestBody(request.body),
      ),
    );
  });

  server.get("/connectors/:provider/oauth/callback", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
    const result = await options.connectorService.handleOAuthCallback(parsed, {
      code: query.code ?? null,
      state: query.state ?? null,
      error: query.error ?? null,
      errorDescription: query.error_description ?? null,
    });
    reply
      .code(result.ok ? 200 : 400)
      .type("text/html; charset=utf-8")
      .send(renderOAuthCallbackHtml(result.title, result.message));
  });

  server.post("/oauth-broker/instagram/graph/start", async (request, reply) => {
    sendJson(
      reply,
      202,
      await options.connectorService.startInstagramGraphOAuthBroker(
        parseBrokerStartBody(request.body),
      ),
    );
  });

  server.get("/oauth-broker/instagram/graph/callback", async (request, reply) => {
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
    const result = await options.connectorService.handleInstagramGraphOAuthBrokerCallback(
      {
        code: query.code ?? null,
        state: query.state ?? null,
        error: query.error ?? null,
        errorDescription: query.error_description ?? null,
      },
    );
    if (result.redirectUrl) {
      reply.redirect(result.redirectUrl);
      return;
    }
    reply
      .code(result.ok ? 200 : 400)
      .type("text/html; charset=utf-8")
      .send(renderOAuthCallbackHtml(result.title, result.message));
  });

  server.post("/oauth-broker/instagram/graph/redeem", async (request, reply) => {
    const result = await options.connectorService.redeemInstagramGraphOAuthBroker(
      parseBrokerRedeemBody(request.body),
    );
    sendJson(reply, result.ok ? 200 : 404, result);
  });

  for (const callbackPath of [
    "/connectors/:provider/graph/broker/callback",
    "/api/connectors/:provider/graph/broker/callback",
  ]) {
    server.get(callbackPath, async (request, reply) => {
      const { provider } = request.params as { provider: string };
      const parsed = parseProvider(provider);
      const query = request.query as { handoff_code?: string };
      const result = await options.connectorService.handleGraphBrokerCallback(
        parsed,
        { handoffCode: query.handoff_code ?? "" },
      );
      reply
        .code(result.ok ? 200 : 400)
        .type("text/html; charset=utf-8")
        .send(renderOAuthCallbackHtml(result.title, result.message));
    });
  }

  server.get(
    "/connectors/:provider/graph/oauth/callback",
    async (request, reply) => {
      const { provider } = request.params as { provider: string };
      const parsed = parseProvider(provider);
      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };
      const result = await options.connectorService.handleGraphDiscoveryCallback(
        parsed,
        {
          code: query.code ?? null,
          state: query.state ?? null,
          error: query.error ?? null,
          errorDescription: query.error_description ?? null,
        },
      );
      reply
        .code(result.ok ? 200 : 400)
        .type("text/html; charset=utf-8")
        .send(renderOAuthCallbackHtml(result.title, result.message));
    },
  );

  server.post("/connectors/:provider/cancel", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(reply, 200, await options.connectorService.cancelLogin(parsed));
  });

  server.post("/connectors/:provider/publish-draft", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    const result = await options.connectorService.publishDraft(
      parsed,
      parsePublishDraftBody(request.body),
    );
    sendJson(reply, result.ok ? 200 : 409, result);
  });

  server.get("/connectors/:provider/profile", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    const result = await options.connectorService.readProfile(parsed);
    sendJson(reply, result.ok ? 200 : 409, result);
  });

  server.post(
    "/connectors/:provider/capabilities/:capabilityId/execute",
    async (request, reply) => {
      const { provider, capabilityId } = request.params as {
        provider: string;
        capabilityId: string;
      };
      const parsed = parseProvider(provider);
      const normalizedCapabilityId = capabilityId.trim();
      if (!normalizedCapabilityId) {
        throw badRequest("실행할 capability id가 필요합니다.");
      }
      const result = await options.connectorService.executeCapability(
        parsed,
        parseExecuteCapabilityBody(normalizedCapabilityId, request.body),
      );
      sendJson(reply, result.ok ? 200 : 409, result);
    },
  );

  server.post("/connectors/:provider/disconnect", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(reply, 200, await options.connectorService.disconnect(parsed));
  });
};

function resolveRequestBaseUrl(request: {
  headers: Record<string, string | string[] | undefined>;
  protocol?: string;
}): string | null {
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const host = forwardedHost ?? firstHeader(request.headers.host);
  if (!host) return null;
  const protocol = forwardedProto ?? request.protocol ?? "http";
  return `${protocol}://${host}`;
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function renderOAuthCallbackHtml(title: string, message: string): string {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 40px; color: #111827; background: #f8fafc; }
      main { max-width: 520px; margin: 12vh auto 0; border: 1px solid #e5e7eb; border-radius: 16px; background: #fff; padding: 28px; }
      h1 { margin: 0 0 12px; font-size: 20px; }
      p { margin: 0; line-height: 1.6; color: #4b5563; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
