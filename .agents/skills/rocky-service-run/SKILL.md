---
name: rocky-service-run
description: Run the local Rocky backend service and optional web UI in this repository. Use when starting the Fastify server, choosing host/port/state-root, exposing the service on 0.0.0.0, launching the web dev server, or verifying local HTTP endpoints such as /agents, /sessions, and /runs.
---

# Rocky Service Run

## Goal

- Start the local backend service reliably.
- Launch the optional web UI against the local backend.
- Expose backend and frontend on the network when a developer explicitly wants that.
- Keep run commands aligned with the repository defaults.

## Environment

- This repository requires `Node >=22`.
- The backend CLI entrypoint is `node dist/src/cli.js`.
- The backend `serve` command defaults to `--host 127.0.0.1 --port 3000`.
- The default control-plane state root is `.runtime/agent-engine`.
- The frontend dev server defaults to `127.0.0.1:4173` and proxies `/api` to `http://127.0.0.1:3000`.

## Workflow

1. Prepare the backend.
- Install dependencies with `npm install` if `node_modules` is missing.
- Build the compiled CLI with `npm run build`.

2. Start the backend service.
- Preferred command:
```bash
node dist/src/cli.js serve --host 127.0.0.1 --port 3000
```
- Equivalent wrapper:
```bash
npm run agent -- serve --host 127.0.0.1 --port 3000
```
- Use `--state-root <path>` when you need isolated server state for a smoke run or experiment.

3. Expose the backend on the network when needed.
- For LAN or reverse-proxy access, bind the backend to all interfaces:
```bash
npm run agent -- serve --host 0.0.0.0 --port 3000
```
- Prefer putting a reverse proxy and auth layer in front of the backend if traffic comes from outside a trusted network.

4. Start the backend and web UI together when needed.
- Launch both services with `npm run dev`.
- For network access during development:
```bash
npm run dev -- --backend-host 0.0.0.0 --web-host 0.0.0.0 --web-port 4173
```

5. Start only the web UI when needed.
- Install web dependencies with `npm --prefix web install` if needed.
- Launch the Vite dev server from the web package.
- For network access during development:
```bash
npm --prefix web run dev -- --host 0.0.0.0 --port 4173
```
- For previewing the built frontend on the network:
```bash
npm --prefix web run preview -- --host 0.0.0.0 --port 4173
```

6. Verify the backend before deeper testing.
- Check a simple route such as:
```bash
curl -sS http://127.0.0.1:3000/agents
```
- When the backend starts successfully, it prints the resolved host, port, and state root as JSON.
- When the frontend is exposed externally, make sure the backend is also reachable from the browser through the expected `/api` path or a reverse proxy.

## Quick Commands

```bash
npm install
npm run build
npm run dev
npm run dev -- --backend-host 0.0.0.0 --web-host 0.0.0.0 --web-port 4173
node dist/src/cli.js serve --host 127.0.0.1 --port 3000
node dist/src/cli.js serve --state-root .runtime/manual-service --host 127.0.0.1 --port 3000
npm run agent -- serve --host 0.0.0.0 --port 3000
curl -sS http://127.0.0.1:3000/agents
npm --prefix web install
npm --prefix web run dev
npm --prefix web run dev -- --host 0.0.0.0 --port 4173
npm --prefix web run preview -- --host 0.0.0.0 --port 4173
```

## Resources

- `package.json`: backend and web run scripts.
- `src/cli/cli-helpers.ts`: CLI usage and default serve options.
- `README.md`: repository quick-start and local run commands.
- `web/vite.config.ts`: frontend host, port, and `/api` proxy defaults.
