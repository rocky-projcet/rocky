import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApplicationMenuSectionTemplate,
  buildApplicationMenuTemplate,
} from "../../electron/menu.js";

test("application menu keeps File, Edit, and View at the top level without Window", () => {
  const labels = buildApplicationMenuTemplate("win32").map((item) => item.label);

  assert.deepEqual(labels, ["File", "Edit", "View", "Help"]);
  assert.equal(labels.includes("Window"), false);
});

test("macOS application menu still omits the Window menu", () => {
  const labels = buildApplicationMenuTemplate("darwin").map((item) => item.label);

  assert.deepEqual(labels, ["Rocky", "File", "Edit", "View", "Help"]);
  assert.equal(labels.includes("Window"), false);
});

test("application menu sections expose native role-backed popup items", () => {
  assert.deepEqual(
    buildApplicationMenuSectionTemplate("file", "win32").map((item) => item.label ?? item.role ?? item.type),
    ["새창으로 열기", "separator", "quit"]
  );
  assert.deepEqual(
    buildApplicationMenuSectionTemplate("edit", "win32").map((item) => item.role ?? item.type),
    ["undo", "redo", "separator", "cut", "copy", "paste", "separator", "selectAll"]
  );
  assert.deepEqual(
    buildApplicationMenuSectionTemplate("view", "win32").map((item) => item.role ?? item.type),
    [
      "reload",
      "forceReload",
      "separator",
      "resetZoom",
      "zoomIn",
      "zoomOut",
      "separator",
      "togglefullscreen",
    ]
  );
  assert.deepEqual(
    buildApplicationMenuSectionTemplate("help", "win32").map((item) => item.label ?? item.role ?? item.type),
    ["About Rocky"]
  );
});
