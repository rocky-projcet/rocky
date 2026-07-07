import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  resolveDesktopApplicationMenu,
  resolveDesktopNavigation,
  type RockyDesktopApplicationMenuId,
  type RockyDesktopNavigationState,
} from "@/shared/lib/desktop-api";
import { useI18n } from "@/shared/lib/i18n-provider";
import { cn } from "@/shared/lib/utils";
import { SidebarTrigger } from "@/shared/ui/sidebar";

const MENU_ITEMS: { id: RockyDesktopApplicationMenuId; labelKey: string }[] = [
  { id: "file", labelKey: "desktop.file" },
  { id: "edit", labelKey: "desktop.edit" },
  { id: "view", labelKey: "desktop.view" },
  { id: "help", labelKey: "desktop.help" },
];

function DesktopHistoryControls() {
  const { t } = useI18n();
  const navigation = resolveDesktopNavigation(globalThis);
  const [state, setState] = useState<RockyDesktopNavigationState>({
    canGoBack: false,
    canGoForward: false,
  });

  useEffect(() => {
    if (!navigation) {
      return;
    }

    let isMounted = true;
    void navigation.getState().then((nextState) => {
      if (isMounted) {
        setState(nextState);
      }
    });

    const unsubscribe = navigation.onStateChanged((nextState) => {
      setState(nextState);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [navigation]);

  if (!navigation) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-7 rounded-md text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
        aria-label={t("desktop.back")}
        title={t("desktop.back")}
        disabled={!state.canGoBack}
        onClick={() => void navigation.goBack().then(setState)}
      >
        <ArrowLeft className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-7 rounded-md text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
        aria-label={t("desktop.forward")}
        title={t("desktop.forward")}
        disabled={!state.canGoForward}
        onClick={() => void navigation.goForward().then(setState)}
      >
        <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}

export function DesktopChromeBar() {
  const { t } = useI18n();
  const navigation = resolveDesktopNavigation(globalThis);
  const applicationMenu = resolveDesktopApplicationMenu(globalThis);

  if (!navigation) {
    return null;
  }

  function handleMenuClick(
    menuId: RockyDesktopApplicationMenuId,
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    void applicationMenu?.showMenu(menuId, {
      x: rect.left,
      y: rect.bottom,
    });
  }

  return (
    <div
      data-desktop-chrome
      className="flex h-9 shrink-0 items-center border-b bg-background px-1 pr-[140px] text-sm text-muted-foreground [-webkit-app-region:drag]"
    >
      <SidebarTrigger
        className="size-7 rounded-md text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]"
        aria-label={t("desktop.toggleSidebar")}
        title={t("desktop.toggleSidebar")}
      />
      <DesktopHistoryControls />
      <nav
        aria-label={t("desktop.appMenu")}
        className="ml-2 flex h-full items-center gap-1 [-webkit-app-region:no-drag]"
      >
        {MENU_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-haspopup="menu"
            onClick={(event) => handleMenuClick(item.id, event)}
            className={cn(
              "flex h-7 items-center rounded-md px-2 font-normal text-muted-foreground",
              "transition-colors hover:bg-muted hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              "[-webkit-app-region:no-drag]",
            )}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </nav>
    </div>
  );
}
