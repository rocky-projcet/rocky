import type { MenuItemConstructorOptions } from "electron";

export type ApplicationMenuId = "file" | "edit" | "view" | "help";

export interface ApplicationMenuActions {
  openNewWindow?: () => void;
  showAbout?: () => void;
}

export interface ApplicationMenuOptions {
  actions?: ApplicationMenuActions;
  appName?: string;
}

function buildNewWindowMenuItem(
  actions?: ApplicationMenuActions
): MenuItemConstructorOptions {
  const item: MenuItemConstructorOptions = {
    label: "새창으로 열기",
    accelerator: "CmdOrCtrl+Shift+N",
  };
  if (actions?.openNewWindow) {
    item.click = actions.openNewWindow;
  }
  return item;
}

function buildAboutMenuItem(
  appName: string,
  actions?: ApplicationMenuActions
): MenuItemConstructorOptions {
  const item: MenuItemConstructorOptions = {
    label: `About ${appName}`,
  };
  if (actions?.showAbout) {
    item.click = actions.showAbout;
  }
  return item;
}

export function buildApplicationMenuSectionTemplate(
  menuId: ApplicationMenuId,
  platform: NodeJS.Platform,
  options: ApplicationMenuOptions = {}
): MenuItemConstructorOptions[] {
  const appName = options.appName ?? "Rocky";
  switch (menuId) {
    case "file":
      return [
        buildNewWindowMenuItem(options.actions),
        { type: "separator" },
        platform === "darwin" ? { role: "close" } : { role: "quit" },
      ];
    case "edit":
      return [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" },
      ];
    case "view":
      return [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ];
    case "help":
      return [buildAboutMenuItem(appName, options.actions)];
  }
}

export function buildApplicationMenuTemplate(
  platform: NodeJS.Platform,
  appName = "Rocky",
  actions?: ApplicationMenuActions
): MenuItemConstructorOptions[] {
  const applicationMenu: MenuItemConstructorOptions[] =
    platform === "darwin"
      ? [
          {
            label: appName,
            submenu: [
              buildAboutMenuItem(appName, actions),
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : [];

  return [
    ...applicationMenu,
    {
      label: "File",
      submenu: buildApplicationMenuSectionTemplate("file", platform, {
        actions,
        appName,
      }),
    },
    {
      label: "Edit",
      submenu: buildApplicationMenuSectionTemplate("edit", platform, {
        actions,
        appName,
      }),
    },
    {
      label: "View",
      submenu: buildApplicationMenuSectionTemplate("view", platform, {
        actions,
        appName,
      }),
    },
    {
      label: "Help",
      submenu: buildApplicationMenuSectionTemplate("help", platform, {
        actions,
        appName,
      }),
    },
  ];
}
