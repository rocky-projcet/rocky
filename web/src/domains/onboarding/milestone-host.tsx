import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PartyPopper, X } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import {
  MILESTONE_EVENT,
  type MilestoneEventDetail,
} from "./milestones";

interface ActiveMilestone extends MilestoneEventDetail {
  id: number;
}

export function MilestoneHost() {
  const [active, setActive] = useState<ActiveMilestone | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    function handle(event: Event) {
      const detail = (event as CustomEvent<MilestoneEventDetail>).detail;
      if (!detail) return;
      idRef.current += 1;
      setActive({ ...detail, id: idRef.current });
    }
    window.addEventListener(MILESTONE_EVENT, handle);
    return () => {
      window.removeEventListener(MILESTONE_EVENT, handle);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
    }
    dismissTimerRef.current = window.setTimeout(() => {
      setActive((current) => (current?.id === active.id ? null : current));
      dismissTimerRef.current = null;
    }, active.durationMs);
    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [active]);

  if (typeof document === "undefined" || !active) return null;

  function dismiss() {
    setActive(null);
  }

  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-6 z-[100001] flex justify-center px-4",
      )}
    >
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-foreground/10 bg-card px-5 py-4 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.25)]",
          "animate-in fade-in zoom-in-95 slide-in-from-top-4 duration-300",
        )}
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background">
          <PartyPopper className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{active.title}</p>
          {active.description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {active.description}
            </p>
          ) : null}
          {active.action ? (
            <div className="mt-3">
              <Button
                size="sm"
                onClick={() => {
                  active.action?.onClick();
                  dismiss();
                }}
              >
                {active.action.label}
              </Button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="닫기"
          className="-mr-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
