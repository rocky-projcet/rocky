import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import { listSupportedProviders } from "../../connectors/adapters.js";
import type {
  ConnectorPublishDraftInput,
  ConnectorProvider,
  ConnectorServiceLike,
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

  server.post("/connectors/:provider/login", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(
      reply,
      202,
      await options.connectorService.startLogin(parsed, {
        redirectBaseUrl: resolveRequestBaseUrl(request),
      }),
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
