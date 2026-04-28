import type { ReactElement } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { cn } from "@/shared/lib/utils";
import { AGENT_AVATAR_COLORS, AGENT_EMOJI_PRESETS } from "../lib/agent-avatar-store";

export function AgentEmojiPicker({
  emoji,
  color,
  onChangeEmoji,
  onChangeColor,
  trigger,
  align = "start",
}: {
  emoji: string;
  color: string | null | undefined;
  onChangeEmoji: (next: string) => void;
  onChangeColor: (next: string | null) => void;
  trigger: ReactElement;
  align?: "start" | "center" | "end";
}) {
  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent align={align} className="w-80 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          캐릭터 이모지
        </p>
        <div className="grid grid-cols-7 gap-1.5">
          {AGENT_EMOJI_PRESETS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChangeEmoji(option)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-xl border text-xl leading-none transition",
                option === emoji
                  ? "border-foreground bg-muted"
                  : "border-transparent bg-background hover:border-border hover:bg-muted/60",
              )}
              aria-label={`이모지 ${option}`}
            >
              <span className="block translate-y-px">{option}</span>
            </button>
          ))}
        </div>

        <p className="mb-2 mt-4 text-xs font-medium text-muted-foreground">배경색</p>
        <div className="grid grid-cols-9 gap-1.5">
          <button
            type="button"
            onClick={() => onChangeColor(null)}
            className={cn(
              "flex aspect-square items-center justify-center rounded-full border-2 text-[10px] text-muted-foreground transition",
              color == null ? "border-foreground" : "border-dashed border-border hover:border-foreground/40",
            )}
            aria-label="배경색 없음"
          >
            ⊘
          </button>
          {AGENT_AVATAR_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChangeColor(option)}
              className={cn(
                "aspect-square rounded-full border-2 transition",
                option === color
                  ? "border-foreground ring-2 ring-offset-1"
                  : "border-transparent hover:scale-110",
              )}
              style={{
                backgroundColor: option,
                ...(option === color
                  ? ({ "--tw-ring-color": `${option}80` } as React.CSSProperties)
                  : {}),
              }}
              aria-label={`색상 ${option}`}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
