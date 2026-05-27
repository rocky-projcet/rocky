#!/usr/bin/env node
import http from "node:http";

const host = process.env.ROCKY_OAUTH_BROKER_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.ROCKY_OAUTH_BROKER_PORT ?? "3010", 10);
const targetBase = process.env.ROCKY_OAUTH_BROKER_TARGET ?? "http://127.0.0.1:3000";
const allowedCallbackPath = "/connectors/instagram/graph/oauth/callback";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("ROCKY_OAUTH_BROKER_PORT must be a valid TCP port.");
}

const targetOrigin = new URL(targetBase);

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method !== "GET") {
    response.writeHead(405, {
      "allow": "GET",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Method Not Allowed");
    return;
  }

  if (requestUrl.pathname === "/healthz") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ ok: true, target: targetOrigin.origin }));
    return;
  }

  if (requestUrl.pathname !== allowedCallbackPath) {
    response.writeHead(404, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Not Found");
    return;
  }

  try {
    const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, targetOrigin);
    const upstream = await fetch(upstreamUrl, {
      headers: {
        "accept": request.headers.accept ?? "text/html,application/xhtml+xml",
        "user-agent": "rocky-oauth-callback-broker",
      },
    });

    response.writeHead(upstream.status, {
      "cache-control": "no-store",
      "content-type": upstream.headers.get("content-type") ?? "text/html; charset=utf-8",
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    response.writeHead(502, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("OAuth callback broker could not reach the local Rocky API.");
  }
});

server.listen(port, host, () => {
  console.log(
    JSON.stringify({
      service: "rocky-oauth-callback-broker",
      host,
      port,
      target: targetOrigin.origin,
      allowedCallbackPath,
    }),
  );
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
