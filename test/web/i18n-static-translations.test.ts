import test from "node:test";
import assert from "node:assert/strict";

import {
  translateStaticText,
  hasStaticKoreanTranslation,
} from "../../web/src/shared/lib/static-translations.js";

test("translateStaticText localizes legacy Korean UI copy in English mode", () => {
  assert.equal(translateStaticText("즐겨찾기", "en"), "Favorites");
  assert.equal(translateStaticText("자주 다시 꺼내보는 결과·답변·작업을 한 곳에 모아요.", "en"), "Collect frequently reused results, answers, and tasks in one place.");
  assert.equal(translateStaticText("업무 문서", "en"), "Work documents");
});

test("translateStaticText handles simple dynamic Korean UI fragments", () => {
  assert.equal(translateStaticText("3개", "en"), "3 items");
  assert.equal(translateStaticText("매 15분", "en"), "Every 15 min");
  assert.equal(translateStaticText("모델 gpt-5.5", "en"), "Model gpt-5.5");
});

test("translateStaticText preserves Korean mode and unknown user content", () => {
  assert.equal(translateStaticText("즐겨찾기", "ko"), "즐겨찾기");
  assert.equal(translateStaticText("내가 직접 쓴 한국어 메모", "en"), "내가 직접 쓴 한국어 메모");
  assert.equal(hasStaticKoreanTranslation("즐겨찾기"), true);
  assert.equal(hasStaticKoreanTranslation("내가 직접 쓴 한국어 메모"), false);
});
