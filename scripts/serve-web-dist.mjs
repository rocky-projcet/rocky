#!/usr/bin/env node

import { createReadStream, statSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "web",
  "dist"
);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: 4173,
    proxyTarget: "http://127.0.0.1:3000",
    root: defaultRoot,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--host":
        options.host = value;
        index += 1;
        break;
      case "--port":
        options.port = Number(value);
        index += 1;
        break;
      case "--proxy-target":
        options.proxyTarget = value;
        index += 1;
        break;
      case "--root":
        options.root = path.resolve(value);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  return options;
}

function isApiRequest(url) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function proxyApiRequest(request, response, proxyTarget) {
  const target = new URL(proxyTarget);
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const proxiedPath = `${requestUrl.pathname.replace(/^\/api/, "") || "/"}${
    requestUrl.search
  }`;

  const headers = { ...request.headers, host: target.host };
  const proxyRequest = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: request.method,
      path: proxiedPath,
      headers,
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    }
  );

  proxyRequest.on("error", (error) => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end(`Rocky API proxy failed: ${error.message}`);
  });

  request.pipe(proxyRequest);
}

function resolveStaticPath(root, pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const relativePath = decodedPath.replace(/^\/+/, "").replaceAll("/", path.sep);
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(root, candidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return candidate;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function chooseStaticFile(root, requestPathname) {
  const requestedPath = resolveStaticPath(root, requestPathname);
  if (!requestedPath) {
    return null;
  }

  try {
    const requestedStat = await stat(requestedPath);
    if (requestedStat.isFile()) {
      return requestedPath;
    }

    if (requestedStat.isDirectory()) {
      const directoryIndex = path.join(requestedPath, "index.html");
      if (await fileExists(directoryIndex)) {
        return directoryIndex;
      }
    }
  } catch {
    // Fall through to the SPA index fallback below.
  }

  const appIndex = path.join(root, "index.html");
  return (await fileExists(appIndex)) ? appIndex : null;
}

async function serveStaticRequest(request, response, root) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const filePath = await chooseStaticFile(root, requestUrl.pathname);

  if (!filePath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const fileStat = statSync(filePath);
  const contentType =
    mimeTypes.get(path.extname(filePath).toLowerCase()) ??
    "application/octet-stream";
  response.writeHead(200, {
    "cache-control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "content-length": fileStat.size,
    "content-type": contentType,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

const options = parseArgs(process.argv.slice(2));
await access(path.join(options.root, "index.html"));

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (isApiRequest(requestUrl)) {
    proxyApiRequest(request, response, options.proxyTarget);
    return;
  }

  void serveStaticRequest(request, response, options.root).catch((error) => {
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end(error instanceof Error ? error.message : "Internal server error");
  });
});

server.listen(options.port, options.host, () => {
  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address ? address.port : options.port;
  console.log(`Rocky WEB: http://${options.host}:${resolvedPort}`);
});
