import assert from "node:assert/strict";
import test from "node:test";

import {
  isDesktopRuntime,
  resolveDesktopApplicationMenu,
  resolveDesktopApiBaseUrl,
  resolveDesktopBridge,
  resolveDesktopNavigation,
  type RockyDesktopApplicationMenuApi,
} from "../../web/src/shared/lib/desktop-api.js";

test("resolveDesktopApiBaseUrl reads the Electron preload bridge", () => {
  const globalValue = {
    rockyDesktop: {
      apiBaseUrl: "http://127.0.0.1:49152",
      platform: "win32",
      isPackaged: true,
    },
  };

  assert.equal(
    resolveDesktopApiBaseUrl(globalValue),
    "http://127.0.0.1:49152"
  );
  assert.deepEqual(resolveDesktopBridge(globalValue), {
    apiBaseUrl: "http://127.0.0.1:49152",
    platform: "win32",
    isPackaged: true,
  });
  assert.equal(isDesktopRuntime(globalValue), true);
});

test("resolveDesktopApiBaseUrl ignores empty or missing bridge values", () => {
  assert.equal(
    resolveDesktopApiBaseUrl({
      rockyDesktop: {
        apiBaseUrl: "  ",
        platform: "darwin",
        isPackaged: true,
      },
    }),
    null
  );

  assert.equal(resolveDesktopApiBaseUrl({}), null);
  assert.equal(
    resolveDesktopBridge({
      rockyDesktop: {
        apiBaseUrl: "  ",
        platform: "darwin",
        isPackaged: true,
      },
    }),
    null
  );
  assert.equal(isDesktopRuntime({}), false);
});

test("resolveDesktopNavigation reads a complete Electron navigation bridge", async () => {
  const state = { canGoBack: true, canGoForward: false };
  const navigation = {
    getState: async () => state,
    goBack: async () => ({ canGoBack: false, canGoForward: true }),
    goForward: async () => state,
    onStateChanged: () => () => undefined,
  };

  const resolved = resolveDesktopNavigation({
    rockyDesktop: {
      apiBaseUrl: "http://127.0.0.1:49152",
      navigation,
      platform: "win32",
      isPackaged: false,
    },
  });

  assert.equal(resolved, navigation);
  assert.deepEqual(await resolved?.getState(), state);
});

test("resolveDesktopNavigation ignores partial navigation bridges", () => {
  assert.equal(
    resolveDesktopNavigation({
      rockyDesktop: {
        apiBaseUrl: "http://127.0.0.1:49152",
        navigation: {
          getState: async () => ({ canGoBack: false, canGoForward: false }),
        },
        platform: "win32",
        isPackaged: false,
      },
    }),
    null
  );
});

test("resolveDesktopApplicationMenu reads a complete menu bridge", async () => {
  const applicationMenu: RockyDesktopApplicationMenuApi = {
    showMenu: async () => true,
  };

  const resolved = resolveDesktopApplicationMenu({
    rockyDesktop: {
      apiBaseUrl: "http://127.0.0.1:49152",
      applicationMenu,
      platform: "win32",
      isPackaged: false,
    },
  });

  assert.equal(resolved, applicationMenu);
  assert.equal(await resolved?.showMenu("edit", { x: 10, y: 20 }), true);
});

test("resolveDesktopApplicationMenu ignores partial menu bridges", () => {
  assert.equal(
    resolveDesktopApplicationMenu({
      rockyDesktop: {
        apiBaseUrl: "http://127.0.0.1:49152",
        applicationMenu: {},
        platform: "win32",
        isPackaged: false,
      },
    }),
    null
  );
});
