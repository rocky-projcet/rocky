import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

function skillTemplateRecord() {
  return {
    id: "template.data",
    source: "user",
    category: "data",
    title: "Sales Analysis",
    description: "Analyze uploaded sales data.",
    triggerLabel: "데이터 분석",
    requiredInputs: ["sales.csv"],
    outputFormatLabel: "보고서",
    defaultInstructions: "데이터 구조를 먼저 확인합니다.",
    skill: {
      id: "md-sales-analysis-123",
      displayName: "Sales Analysis",
      description: "Use when analyzing sales data.",
      invocation: "$md-sales-analysis-123",
      skillMarkdown: "---\nname: md-sales-analysis-123\n---\n# Sales Analysis\n",
      openAiYaml: "name: md-sales-analysis-123\n",
      syncStatus: "local",
      workspacePath: null,
    },
    sortOrder: 1,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

test("skill template routes persist saved skills under the runtime state root", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "skill-template-api-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-01T00:00:00.000Z",
  });

  try {
    const record = skillTemplateRecord();
    const saveResponse = await server.inject({
      method: "PUT",
      url: "/skills/template.data",
      payload: record,
    });
    assert.equal(saveResponse.statusCode, 200);
    assert.equal(saveResponse.json().id, "template.data");

    const skillRoot = path.join(stateRoot, "skills", "template.data");
    await access(path.join(skillRoot, "skill.json"));
    const skillMarkdown = await readFile(
      path.join(skillRoot, "files", "SKILL.md"),
      "utf8"
    );
    assert.match(skillMarkdown, /Sales Analysis/u);
    assert.match(skillMarkdown, /Create every final deliverable file under `outputs\/`/u);
    assert.match(
      await readFile(path.join(skillRoot, "files", "agents", "openai.yaml"), "utf8"),
      /md-sales-analysis-123/u
    );

    const listResponse = await server.inject({
      method: "GET",
      url: "/skills",
    });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json<Array<{ id: string }>>().map((entry) => entry.id),
      ["template.data"]
    );
  } finally {
    await server.close();
  }
});

test("skill template run uploads materialize input files by run and field", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "skill-template-run-api-"));
  let nextId = 0;
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-01T00:00:00.000Z",
    idGenerator: () => (nextId++ === 0 ? "run-001" : "upload-001"),
  });

  try {
    const createRunResponse = await server.inject({
      method: "POST",
      url: "/skill-template-runs",
      payload: { templateKind: "data" },
    });
    assert.equal(createRunResponse.statusCode, 201);
    assert.equal(createRunResponse.json().id, "run-001");

    const uploadResponse = await server.inject({
      method: "POST",
      url: "/skill-template-runs/run-001/uploads",
      payload: {
        fieldId: "dataset",
        fileName: "sales.csv",
        contentType: "text/csv",
        contentBase64: Buffer.from("sku,sales\nA,10\n").toString("base64"),
      },
    });
    assert.equal(uploadResponse.statusCode, 201);
    assert.equal(uploadResponse.json().runtimePath, "skill-template-runs/run-001/inputs/dataset/upload-001/sales.csv");

    const uploadPath = path.join(
      stateRoot,
      "skill-template-runs",
      "run-001",
      "inputs",
      "dataset",
      "upload-001",
      "sales.csv"
    );
    assert.equal(await readFile(uploadPath, "utf8"), "sku,sales\nA,10\n");
    await access(path.join(path.dirname(uploadPath), "metadata.json"));

    const artifact = uploadResponse.json();
    const record = {
      ...skillTemplateRecord(),
      id: "template.data-upload",
      inputFiles: [artifact.fileName],
      inputArtifacts: [artifact],
    };
    const saveResponse = await server.inject({
      method: "PUT",
      url: "/skills/template.data-upload",
      payload: record,
    });
    assert.equal(saveResponse.statusCode, 200);
    assert.equal(
      saveResponse.json().inputArtifacts[0].skillPath,
      "assets/inputs/dataset/upload-001/sales.csv"
    );

    const packagedUploadPath = path.join(
      stateRoot,
      "skills",
      "template.data-upload",
      "files",
      "assets",
      "inputs",
      "dataset",
      "upload-001",
      "sales.csv"
    );
    assert.equal(await readFile(packagedUploadPath, "utf8"), "sku,sales\nA,10\n");

    const filesResponse = await server.inject({
      method: "GET",
      url: "/skills/template.data-upload/files",
    });
    assert.equal(filesResponse.statusCode, 200);
    const packagedFiles = filesResponse.json<Array<{ path: string }>>();
    assert.ok(packagedFiles.some((file) => file.path === "SKILL.md"));
    assert.ok(
      packagedFiles.some(
        (file) => file.path === "assets/inputs/dataset/upload-001/sales.csv"
      )
    );

    const createAgentResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "agent-with-packaged-skill",
        name: "Packaged Skill Agent",
      },
    });
    assert.equal(createAgentResponse.statusCode, 201);
    const agent = createAgentResponse.json<{ workspaceRoot: string; runtimeHome: string }>();
    const installResponse = await server.inject({
      method: "PUT",
      url: "/agents/agent-with-packaged-skill/skills/md-sales-analysis-123",
      payload: {
        replace: true,
        files: filesResponse.json(),
      },
    });
    assert.equal(installResponse.statusCode, 200);
    await access(
      path.join(
        agent.workspaceRoot,
        ".agents",
        "skills",
        "md-sales-analysis-123",
        "assets",
        "inputs",
        "dataset",
        "upload-001",
        "sales.csv"
      )
    );
    await access(
      path.join(
        agent.runtimeHome,
        ".codex",
        "skills",
        "md-sales-analysis-123",
        "assets",
        "inputs",
        "dataset",
        "upload-001",
        "sales.csv"
      )
    );
  } finally {
    await server.close();
  }
});

test("skill template file reads repair legacy packages with uploaded input artifacts", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "skill-template-repair-api-"));
  let nextId = 0;
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-01T00:00:00.000Z",
    idGenerator: () => (nextId++ === 0 ? "run-001" : "upload-001"),
  });

  try {
    const createRunResponse = await server.inject({
      method: "POST",
      url: "/skill-template-runs",
      payload: { templateKind: "data" },
    });
    assert.equal(createRunResponse.statusCode, 201);

    const uploadResponse = await server.inject({
      method: "POST",
      url: "/skill-template-runs/run-001/uploads",
      payload: {
        fieldId: "dataset",
        fileName: "sales.csv",
        contentType: "text/csv",
        contentBase64: Buffer.from("sku,sales\nA,10\n").toString("base64"),
      },
    });
    assert.equal(uploadResponse.statusCode, 201);

    const legacyRecord = {
      ...skillTemplateRecord(),
      id: "template.legacy-upload",
      inputFiles: ["sales.csv"],
      inputArtifacts: [uploadResponse.json()],
    };
    const legacyRoot = path.join(stateRoot, "skills", "template.legacy-upload");
    await mkdir(path.join(legacyRoot, "files", "agents"), { recursive: true });
    await writeFile(
      path.join(legacyRoot, "skill.json"),
      `${JSON.stringify(legacyRecord, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      path.join(legacyRoot, "files", "SKILL.md"),
      legacyRecord.skill.skillMarkdown,
      "utf8"
    );
    await writeFile(
      path.join(legacyRoot, "files", "agents", "openai.yaml"),
      legacyRecord.skill.openAiYaml,
      "utf8"
    );

    const filesResponse = await server.inject({
      method: "GET",
      url: "/skills/template.legacy-upload/files",
    });
    assert.equal(filesResponse.statusCode, 200);
    const packagedFiles = filesResponse.json<Array<{ path: string }>>();
    assert.ok(
      packagedFiles.some(
        (file) => file.path === "assets/inputs/dataset/upload-001/sales.csv"
      )
    );

    const repairedRecord = JSON.parse(
      await readFile(path.join(legacyRoot, "skill.json"), "utf8")
    );
    assert.equal(
      repairedRecord.inputArtifacts[0].skillPath,
      "assets/inputs/dataset/upload-001/sales.csv"
    );
    assert.match(
      await readFile(path.join(legacyRoot, "files", "SKILL.md"), "utf8"),
      /Packaged Input Files[\s\S]*assets\/inputs\/dataset\/upload-001\/sales\.csv/u
    );
  } finally {
    await server.close();
  }
});

test("external skill preview stores an isolated package and mounts it as a common skill", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "external-skill-api-"));
  let nextId = 0;
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-19T00:00:00.000Z",
    idGenerator: () => (nextId++ === 0 ? "preview-001" : "unused-id"),
  });

  try {
    const previewResponse = await server.inject({
      method: "POST",
      url: "/skills/external/preview",
      payload: {
        sourceKind: "github",
        sourceUrl: "https://github.com/example/skills/tree/main/research",
        files: [
          {
            path: "SKILL.md",
            content:
              "---\nname: external-research\n---\n# External Research\nUse when researching explicit inputs.\n",
          },
          {
            path: "scripts/run.mjs",
            content: "console.log(JSON.stringify({ ok: true }));\n",
          },
        ],
      },
    });
    assert.equal(previewResponse.statusCode, 201);
    const preview = previewResponse.json<{
      id: string;
      installable: boolean;
      skillId: string;
      packageHash: string;
      checks: Array<{ id: string; status: string }>;
    }>();
    assert.equal(preview.id, "preview-001");
    assert.equal(preview.installable, true);
    assert.equal(preview.skillId, "external-research");
    assert.match(preview.packageHash, /^sha256:/u);
    assert.ok(
      preview.checks.some(
        (check) => check.id === "skill-md" && check.status === "passed",
      ),
    );
    await access(
      path.join(
        stateRoot,
        "external-skill-previews",
        "preview-001",
        "package",
        "SKILL.md",
      ),
    );

    const mountResponse = await server.inject({
      method: "POST",
      url: "/skills/external/previews/preview-001/mount",
    });
    assert.equal(mountResponse.statusCode, 201);
    assert.equal(mountResponse.json().skill.id, "external.external-research");

    const filesResponse = await server.inject({
      method: "GET",
      url: "/skills/external.external-research/files",
    });
    assert.equal(filesResponse.statusCode, 200);
    const files = filesResponse.json<Array<{ path: string }>>();
    assert.ok(files.some((file) => file.path === "SKILL.md"));
    assert.ok(files.some((file) => file.path === "scripts/run.mjs"));
  } finally {
    await server.close();
  }
});

test("external skill preview fetches a skills.sh GitHub package URL", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "external-skill-url-api-"));
  const originalFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (
      url ===
      "https://api.github.com/repos/coreyhaines31/marketingskills/contents/skills/social-content?ref=main"
    ) {
      return new Response(
        JSON.stringify([
          {
            type: "file",
            path: "skills/social-content/SKILL.md",
            download_url:
              "https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/social-content/SKILL.md",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url ===
      "https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/social-content/SKILL.md"
    ) {
      return new Response(
        "---\nname: social-content\ndescription: Social content helper.\n---\n# Social Content\n",
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-19T00:00:00.000Z",
    idGenerator: () => "preview-url",
  });

  try {
    const previewResponse = await server.inject({
      method: "POST",
      url: "/skills/external/preview",
      payload: {
        sourceKind: "mcp-market",
        sourceUrl:
          "https://www.skills.sh/coreyhaines31/marketingskills/social-content",
      },
    });
    assert.equal(previewResponse.statusCode, 201);
    const preview = previewResponse.json<{
      installable: boolean;
      skillId: string;
      fileCount: number;
      checks: Array<{ id: string; status: string; message: string }>;
    }>();
    assert.equal(preview.installable, true);
    assert.equal(preview.skillId, "social-content");
    assert.equal(preview.fileCount, 1);
    assert.ok(
      preview.checks.some(
        (check) =>
          check.id === "source" &&
          check.status === "passed" &&
          /Remote package source fetched/u.test(check.message),
      ),
    );
    assert.ok(
      fetchedUrls.includes(
        "https://api.github.com/repos/coreyhaines31/marketingskills/contents/skills/social-content?ref=main",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
});

test("external skill preview resolves a skills.sh slug from the SKILL.md title", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "external-skill-slug-api-"));
  const originalFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (
      url ===
      "https://api.github.com/repos/coreyhaines31/marketingskills/contents/skills?ref=main"
    ) {
      return new Response(
        JSON.stringify([
          { type: "dir", name: "copywriting", path: "skills/copywriting" },
          { type: "dir", name: "social", path: "skills/social" },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url ===
      "https://api.github.com/repos/coreyhaines31/marketingskills/contents/skills/social/SKILL.md?ref=main"
    ) {
      return new Response(
        JSON.stringify({
          type: "file",
          path: "skills/social/SKILL.md",
          download_url:
            "https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/social/SKILL.md",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url ===
      "https://api.github.com/repos/coreyhaines31/marketingskills/contents/skills/social?ref=main"
    ) {
      return new Response(
        JSON.stringify([
          {
            type: "file",
            path: "skills/social/SKILL.md",
            download_url:
              "https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/social/SKILL.md",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url ===
      "https://raw.githubusercontent.com/coreyhaines31/marketingskills/main/skills/social/SKILL.md"
    ) {
      return new Response(
        "---\nname: social\ndescription: Social media helper.\n---\n# Social Content\n",
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-19T00:00:00.000Z",
    idGenerator: () => "preview-slug-url",
  });

  try {
    const previewResponse = await server.inject({
      method: "POST",
      url: "/skills/external/preview",
      payload: {
        sourceKind: "mcp-market",
        sourceUrl:
          "https://www.skills.sh/coreyhaines31/marketingskills/social-content",
      },
    });
    assert.equal(previewResponse.statusCode, 201);
    const preview = previewResponse.json<{
      installable: boolean;
      skillId: string;
      fileCount: number;
    }>();
    assert.equal(preview.installable, true);
    assert.equal(preview.skillId, "social");
    assert.equal(preview.fileCount, 1);
    assert.ok(
      fetchedUrls.includes(
        "https://api.github.com/repos/coreyhaines31/marketingskills/contents/skills?ref=main",
      ),
    );
    assert.ok(
      fetchedUrls.includes(
        "https://api.github.com/repos/coreyhaines31/marketingskills/contents/skills/social?ref=main",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
});

test("external skill preview resolves a nested skills.sh package path", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "external-skill-nested-api-"));
  const originalFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (
      url ===
      "https://api.github.com/repos/postplusai/postplus-skills/contents/skills?ref=main"
    ) {
      return new Response(
        JSON.stringify([
          { type: "dir", name: "10-content", path: "skills/10-content" },
          { type: "dir", name: "50-publishing", path: "skills/50-publishing" },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url ===
      "https://api.github.com/repos/postplusai/postplus-skills/contents/skills/50-publishing?ref=main"
    ) {
      return new Response(
        JSON.stringify([
          {
            type: "dir",
            name: "social-media-publisher",
            path: "skills/50-publishing/social-media-publisher",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url ===
      "https://api.github.com/repos/postplusai/postplus-skills/contents/skills/50-publishing/social-media-publisher/SKILL.md?ref=main"
    ) {
      return new Response(
        JSON.stringify({
          type: "file",
          path: "skills/50-publishing/social-media-publisher/SKILL.md",
          download_url:
            "https://raw.githubusercontent.com/postplusai/postplus-skills/main/skills/50-publishing/social-media-publisher/SKILL.md",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url ===
      "https://api.github.com/repos/postplusai/postplus-skills/contents/skills/50-publishing/social-media-publisher?ref=main"
    ) {
      return new Response(
        JSON.stringify([
          {
            type: "file",
            path: "skills/50-publishing/social-media-publisher/SKILL.md",
            download_url:
              "https://raw.githubusercontent.com/postplusai/postplus-skills/main/skills/50-publishing/social-media-publisher/SKILL.md",
          },
          {
            type: "file",
            path: "skills/50-publishing/social-media-publisher/scripts/create_post.mjs",
            download_url:
              "https://raw.githubusercontent.com/postplusai/postplus-skills/main/skills/50-publishing/social-media-publisher/scripts/create_post.mjs",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (
      url ===
      "https://raw.githubusercontent.com/postplusai/postplus-skills/main/skills/50-publishing/social-media-publisher/SKILL.md"
    ) {
      return new Response(
        "---\nname: social-media-publisher\ndescription: Social publishing helper.\n---\n# Social Media Publisher\n",
        { status: 200 },
      );
    }
    if (
      url ===
      "https://raw.githubusercontent.com/postplusai/postplus-skills/main/skills/50-publishing/social-media-publisher/scripts/create_post.mjs"
    ) {
      return new Response("console.log(JSON.stringify({ ok: true }));\n", {
        status: 200,
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-19T00:00:00.000Z",
    idGenerator: () => "preview-nested-url",
  });

  try {
    const previewResponse = await server.inject({
      method: "POST",
      url: "/skills/external/preview",
      payload: {
        sourceKind: "mcp-market",
        sourceUrl:
          "https://www.skills.sh/postplusai/postplus-skills/social-media-publisher",
      },
    });
    assert.equal(previewResponse.statusCode, 201);
    const preview = previewResponse.json<{
      installable: boolean;
      skillId: string;
      fileCount: number;
    }>();
    assert.equal(preview.installable, true);
    assert.equal(preview.skillId, "social-media-publisher");
    assert.equal(preview.fileCount, 2);
    assert.ok(
      fetchedUrls.includes(
        "https://api.github.com/repos/postplusai/postplus-skills/contents/skills/50-publishing/social-media-publisher?ref=main",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
});

test("external connected execution skills block credential injection without allowed API origins", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "external-skill-gate-api-"));
  let nextId = 0;
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-19T00:00:00.000Z",
    idGenerator: () => {
      nextId += 1;
      return nextId === 1 ? "preview-unsafe" : "agent-unsafe";
    },
  });

  try {
    const previewResponse = await server.inject({
      method: "POST",
      url: "/skills/external/preview",
      payload: {
        sourceKind: "upload",
        files: [
          {
            path: "SKILL.md",
            content:
              "---\nname: instagram-publisher\n---\n# Instagram Publisher\n",
          },
          {
            path: "connector-capabilities.json",
            content: JSON.stringify({
              provider: "instagram",
              capabilities: [
                {
                  id: "instagram.content.publish",
                  action: "write",
                  requiresConnectedAccount: true,
                  requiredEnv: [
                    "INSTAGRAM_ACCESS_TOKEN",
                    "INSTAGRAM_ACCOUNT_ID",
                  ],
                  allowedEndpointPaths: [
                    "/{ig-user-id}/media",
                    "/{ig-user-id}/media_publish",
                  ],
                  requiresApproval: true,
                  scriptPath: "scripts/publish.mjs",
                },
              ],
            }),
          },
          {
            path: "scripts/publish.mjs",
            content:
              "await fetch('https://graph.facebook.com/v22.0/me');\n",
          },
        ],
      },
    });
    assert.equal(previewResponse.statusCode, 201);
    const preview = previewResponse.json<{
      installable: boolean;
      capabilities: Array<{
        id: string;
        credentialGateStatus: string;
        reasons: string[];
      }>;
    }>();
    assert.equal(preview.installable, true);
    assert.equal(preview.capabilities[0]?.id, "instagram.content.publish");
    assert.equal(preview.capabilities[0]?.credentialGateStatus, "blocked");
    assert.ok(
      preview.capabilities[0]?.reasons.some((reason) =>
        /allowedBaseUrls/u.test(reason),
      ),
    );

    const mountResponse = await server.inject({
      method: "POST",
      url: "/skills/external/previews/preview-unsafe/mount",
    });
    assert.equal(mountResponse.statusCode, 201);

    const createAgentResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "agent-unsafe",
        name: "Unsafe Skill Agent",
      },
    });
    assert.equal(createAgentResponse.statusCode, 201);

    const filesResponse = await server.inject({
      method: "GET",
      url: "/skills/external.instagram-publisher/files",
    });
    assert.equal(filesResponse.statusCode, 200);

    const installResponse = await server.inject({
      method: "PUT",
      url: "/agents/agent-unsafe/skills/instagram-publisher",
      payload: {
        replace: true,
        files: filesResponse.json(),
      },
    });
    assert.equal(installResponse.statusCode, 200);

    const integrationsResponse = await server.inject({
      method: "GET",
      url: "/agents/agent-unsafe/integrations",
    });
    assert.equal(integrationsResponse.statusCode, 200);
    const integrations = integrationsResponse.json<
      Array<{
        provider: string;
        capabilities: Array<{
          id: string;
          status?: string;
          credentialGateStatus?: string;
          credentialGateReasons?: string[];
        }>;
      }>
    >();
    const capability = integrations[0]?.capabilities.find(
      (entry) => entry.id === "instagram.content.publish",
    );
    assert.equal(capability?.status, "unsupported");
    assert.equal(capability?.credentialGateStatus, "blocked");
  } finally {
    await server.close();
  }
});
