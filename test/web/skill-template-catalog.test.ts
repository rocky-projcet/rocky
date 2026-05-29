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

test("content skill keeps Instagram draft creation independent from publish account setup", () => {
  const contentTemplate = SKILL_TEMPLATES.content;
  const publishStep = contentTemplate.steps.find(
    (step) => step.id === "content-publish-account",
  );
  const accountField = publishStep?.fields.find(
    (field) => field.id === "publishAccount",
  );
  const publishModeField = publishStep?.fields.find(
    (field) => field.id === "autoPublish",
  );

  assert.equal(publishStep?.skippable, true);
  assert.equal(accountField?.optional, true);
  assert.match(publishStep?.helper ?? "", /계정 연결이 없어도/u);
  assert.equal(accountField?.label, "이 스킬에 사용할 계정");
  assert.deepEqual(
    publishModeField?.options?.map((option) => [option.id, option.label]),
    [
      ["draft-only", "초안만 만들기 (직접 올림)"],
      ["review-then-publish", "발행까지 연결하기 (확인 후 실행)"],
      ["schedule", "예약 발행"],
    ],
  );
});
