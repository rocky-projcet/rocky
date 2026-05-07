import { useEffect, useRef } from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./product-tour.css";

import {
  hasMiniTourFired,
  markMiniTourFired,
  type MiniTourKey,
} from "./mini-tour-state";

export interface MiniTourSpotlight {
  element: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  title: string;
  description: string;
}

/**
 * Fire a one-time single-page driver.js spotlight on first arrival.
 * No-op when the flag is already set, when `enabled` is false, or when
 * the anchor element isn't present in the DOM by the time the timer fires.
 */
export function useMiniTour({
  key,
  enabled,
  spotlight,
  delayMs = 350,
}: {
  key: MiniTourKey;
  enabled: boolean;
  spotlight: MiniTourSpotlight;
  delayMs?: number;
}): void {
  const driverRef = useRef<Driver | null>(null);
  const fireKey = `${key}::${spotlight.element}`;

  useEffect(() => {
    if (!enabled) return;
    if (hasMiniTourFired(key)) return;

    let destroyed = false;
    const timer = window.setTimeout(() => {
      if (destroyed) return;
      if (!document.querySelector(spotlight.element)) return;

      const d = driver({
        animate: true,
        smoothScroll: true,
        showProgress: false,
        allowClose: true,
        overlayColor: "oklch(0.145 0 0)",
        overlayOpacity: 0.5,
        stagePadding: 8,
        stageRadius: 14,
        popoverClass: "rocky-tour-popover",
        showButtons: ["next", "close"],
        nextBtnText: "확인",
        onDestroyed: () => {
          driverRef.current = null;
        },
      });
      d.highlight({
        element: spotlight.element,
        popover: {
          side: spotlight.side ?? "bottom",
          align: spotlight.align ?? "center",
          title: spotlight.title,
          description: spotlight.description,
        },
      });
      driverRef.current = d;
      markMiniTourFired(key);
    }, delayMs);

    return () => {
      destroyed = true;
      window.clearTimeout(timer);
      driverRef.current?.destroy();
      driverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fireKey]);
}
