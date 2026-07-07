import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LOCALE,
  getCatalogCoverage,
  isSupportedLocale,
  normalizeLocale,
  t,
} from "../../web/src/shared/lib/i18n.js";

test("normalizeLocale defaults to Korean and accepts supported English locales", () => {
  assert.equal(DEFAULT_LOCALE, "ko");
  assert.equal(normalizeLocale(null), "ko");
  assert.equal(normalizeLocale(""), "ko");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("ko-KR"), "ko");
  assert.equal(isSupportedLocale("ja"), false);
});

test("t resolves Korean and English catalog entries with Korean fallback", () => {
  assert.equal(t("common.loading", "ko"), "불러오는 중입니다.");
  assert.equal(t("common.loading", "en"), "Loading.");
  assert.equal(t("missing.translation.key", "en"), "missing.translation.key");
});

test("getCatalogCoverage reports missing locale keys", () => {
  assert.deepEqual(getCatalogCoverage(), {
    en: [],
    ko: [],
  });
});
