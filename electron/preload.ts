import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rockyDesktop", {
  applicationMenu: {
    showMenu: (menuId: string, position: { x: number; y: number }) =>
      ipcRenderer.invoke("rocky:application-menu-popup", {
        menuId,
        x: position.x,
        y: position.y,
      }),
  },
  apiBaseUrl: process.env.ROCKY_DESKTOP_API_BASE_URL ?? "",
  isPackaged: process.env.ROCKY_DESKTOP_IS_PACKAGED === "1",
  navigation: {
    getState: () => ipcRenderer.invoke("rocky:navigation-state"),
    goBack: () => ipcRenderer.invoke("rocky:navigation-back"),
    goForward: () => ipcRenderer.invoke("rocky:navigation-forward"),
    onStateChanged: (listener: (state: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
        listener(state);
      };
      ipcRenderer.on("rocky:navigation-state-changed", handler);
      return () => {
        ipcRenderer.removeListener("rocky:navigation-state-changed", handler);
      };
    },
  },
  platform: process.platform,
});
