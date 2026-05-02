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
    assert.match(
      await readFile(path.join(skillRoot, "files", "SKILL.md"), "utf8"),
      /Sales Analysis/u
    );
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
