import test from "node:test";
import assert from "node:assert/strict";

import {
  getStaticDomTranslationBatchLimits,
  getStaticDomTranslationObserverOptions,
} from "../../web/src/shared/lib/static-dom-translations.js";

test("static DOM translation observes added subtrees without React text churn", () => {
  const options = getStaticDomTranslationObserverOptions();

  assert.equal(options.childList, true);
  assert.equal(options.subtree, true);
  assert.equal(options.characterData, undefined);
  assert.equal(options.attributes, undefined);
  assert.equal("attributeFilter" in options, false);
});

test("static DOM translation keeps each browser flush bounded", () => {
  const limits = getStaticDomTranslationBatchLimits();

  assert.ok(limits.textNodesPerFlush > 0);
  assert.ok(limits.attributeElementsPerFlush > 0);
  assert.ok(limits.textNodesPerFlush <= 250);
  assert.ok(limits.attributeElementsPerFlush <= 250);
});
