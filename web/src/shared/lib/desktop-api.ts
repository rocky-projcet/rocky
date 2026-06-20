export type RockyDesktopApplicationMenuId = "file" | "edit" | "view" | "help";

export interface RockyDesktopApplicationMenuApi {
  showMenu: (
    menuId: RockyDesktopApplicationMenuId,
    position: { x: number; y: number },
  ) => Promise<boolean>;
}

export interface RockyDesktopNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface RockyDesktopNavigationApi {
  getState: () => Promise<RockyDesktopNavigationState>;
  goBack: () => Promise<RockyDesktopNavigationState>;
  goForward: () => Promise<RockyDesktopNavigationState>;
  onStateChanged: (
    listener: (state: RockyDesktopNavigationState) => void,
  ) => () => void;
}

export interface RockyDesktopBridge {
  applicationMenu?: RockyDesktopApplicationMenuApi;
  apiBaseUrl: string;
  isPackaged: boolean;
  navigation?: RockyDesktopNavigationApi;
  platform: string;
}

export interface RockyDesktopGlobal {
  rockyDesktop?: RockyDesktopBridge;
}

export function resolveDesktopBridge(value: unknown): RockyDesktopBridge | null {
  const candidate = value as RockyDesktopGlobal;
  const bridge = candidate.rockyDesktop;
  return bridge &&
    typeof bridge.apiBaseUrl === "string" &&
    bridge.apiBaseUrl.trim()
    ? bridge
    : null;
}

export function resolveDesktopApiBaseUrl(value: unknown): string | null {
  const apiBaseUrl = resolveDesktopBridge(value)?.apiBaseUrl;
  return typeof apiBaseUrl === "string" && apiBaseUrl.trim()
    ? apiBaseUrl.trim()
    : null;
}

export function resolveDesktopNavigation(
  value: unknown,
): RockyDesktopNavigationApi | null {
  const navigation = resolveDesktopBridge(value)?.navigation;
  return navigation &&
    typeof navigation.getState === "function" &&
    typeof navigation.goBack === "function" &&
    typeof navigation.goForward === "function" &&
    typeof navigation.onStateChanged === "function"
    ? navigation
    : null;
}

export function resolveDesktopApplicationMenu(
  value: unknown,
): RockyDesktopApplicationMenuApi | null {
  const applicationMenu = resolveDesktopBridge(value)?.applicationMenu;
  return applicationMenu && typeof applicationMenu.showMenu === "function"
    ? applicationMenu
    : null;
}

export function isDesktopRuntime(value: unknown): boolean {
  return resolveDesktopBridge(value) !== null;
}
