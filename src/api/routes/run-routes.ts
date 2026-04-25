import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { SessionServiceLike } from "../api-types.js";
import {
  buildArtifactRecords,
  openArtifactInPowerPoint,
  sendArtifactDownload,
  sendArtifactPreview,
} from "../http/artifacts.js";
import type { NativeFileOpener } from "../http/native-open.js";
import { sendJson } from "../http/reply.js";
import { streamRunEventsAsSse } from "../http/sse.js";

interface RunRoutesOptions extends FastifyPluginOptions {
  sessionService: SessionServiceLike;
  nativeFileOpener?: NativeFileOpener;
}

export const registerRunRoutes: FastifyPluginAsync<RunRoutesOptions> = async (
  server,
  options
) => {
  server.get("/runs/:runId", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    sendJson(reply, 200, await options.sessionService.getRun(runId));
  });

  server.get("/runs/:runId/artifacts", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = await options.sessionService.getRun(runId);
    const result = await options.sessionService.getRunResult(runId);
    sendJson(reply, 200, await buildArtifactRecords(run, result));
  });

  server.get("/runs/:runId/artifacts/:artifactRole", async (request, reply) => {
    const { runId, artifactRole } = request.params as {
      runId: string;
      artifactRole: string;
    };
    const run = await options.sessionService.getRun(runId);
    const result = await options.sessionService.getRunResult(runId);
    await sendArtifactDownload(reply, run, result, artifactRole);
  });

  server.get("/runs/:runId/artifacts/:artifactRole/preview", async (request, reply) => {
    const { runId, artifactRole } = request.params as {
      runId: string;
      artifactRole: string;
    };
    const run = await options.sessionService.getRun(runId);
    const result = await options.sessionService.getRunResult(runId);
    await sendArtifactPreview(reply, run, result, artifactRole);
  });

  server.post("/runs/:runId/artifacts/:artifactRole/open-native", async (request, reply) => {
    const { runId, artifactRole } = request.params as {
      runId: string;
      artifactRole: string;
    };
    const run = await options.sessionService.getRun(runId);
    const result = await options.sessionService.getRunResult(runId);
    sendJson(
      reply,
      200,
      await openArtifactInPowerPoint(
        run,
        result,
        artifactRole,
        options.nativeFileOpener
      )
    );
  });

  server.get("/runs/:runId/result", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    sendJson(reply, 200, await options.sessionService.getRunResult(runId));
  });

  server.get("/runs/:runId/events", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    await streamRunEventsAsSse(reply, options.sessionService.streamRunEvents(runId));
  });

  server.post("/runs/:runId/cancel", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    await options.sessionService.cancelRun(runId);
    sendJson(reply, 200, await options.sessionService.getRunResult(runId));
  });
};
