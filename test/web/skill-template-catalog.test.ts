import test from "node:test";
import assert from "node:assert/strict";

import { SKILL_TEMPLATES } from "../../web/src/domains/skill/lib/skill-template-catalog.js";

test("data skill selects ERP before choosing ECOUNT integration", () => {
  const dataTemplate = SKILL_TEMPLATES.data;
  const dataSourceField = dataTemplate.steps
    .flatMap((step) => step.fields)
    .find((field) => field.id === "dataSource");
  const dataSourceIds = dataSourceField?.options?.map((option) => option.id) ?? [];

  assert.deepEqual(dataSourceIds, ["file-upload", "erp", "file-and-erp"]);
  assert.equal(
    dataSourceField?.options?.find((option) => option.id === "erp")?.label,
    "ERP"
  );

  const erpProviderStep = dataTemplate.steps.find((step) => step.id === "erp-provider");
  assert.deepEqual(erpProviderStep?.showWhen, {
    fieldId: "dataSource",
    values: ["erp", "file-and-erp", "ecount-erp", "file-and-ecount"],
  });
  assert.equal(erpProviderStep?.fields[0]?.kind, "erp-integration-select");
  assert.deepEqual(erpProviderStep?.fields[0]?.options, [
    { id: "ecount", label: "이카운트 ERP" },
  ]);
});

test("ECOUNT skill settings do not include connection-test credential fields", () => {
  const dataTemplate = SKILL_TEMPLATES.data;
  const ecountStep = dataTemplate.steps.find((step) => step.id === "ecount-erp");
  const ecountFieldIds = ecountStep?.fields.map((field) => field.id) ?? [];

  assert.deepEqual(ecountStep?.showWhen, {
    fieldId: "erpIntegration",
    values: ["ecount"],
  });
  assert.deepEqual(ecountFieldIds, [
    "ecountDataScope",
    "ecountPeriod",
    "ecountWritePolicy",
  ]);
  assert.equal(
    ecountStep?.fields
      .find((field) => field.id === "ecountDataScope")
      ?.options?.find((option) => option.id === "items")?.disabled,
    undefined
  );
  assert.equal(
    ecountStep?.fields
      .find((field) => field.id === "ecountDataScope")
      ?.options?.find((option) => option.id === "inventory")?.disabled,
    undefined
  );
  assert.equal(
    ecountStep?.fields
      .find((field) => field.id === "ecountDataScope")
      ?.options?.find((option) => option.id === "purchase")?.disabled,
    undefined
  );
  assert.equal(
    ecountStep?.fields
      .find((field) => field.id === "ecountDataScope")
      ?.options?.find((option) => option.id === "sales")?.disabled,
    true
  );
  assert.equal(
    ecountStep?.fields.some((field) => field.kind === "erp-integration-select"),
    false
  );
});
