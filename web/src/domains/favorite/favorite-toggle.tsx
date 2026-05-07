import { Star } from "lucide-react";
import { toast } from "sonner";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import type { FavoriteCreateInput } from "@/shared/lib/agent-engine-client";

import {
  findFavoriteId,
  useAddFavoriteMutation,
  useFavoritesQuery,
  useRemoveFavoriteMutation,
} from "./hooks";

export function FavoriteToggle({
  input,
  size = "sm",
  className,
}: {
  input: FavoriteCreateInput;
  size?: "sm" | "md";
  className?: string;
}) {
  const favoritesQuery = useFavoritesQuery();
  const addMutation = useAddFavoriteMutation();
  const removeMutation = useRemoveFavoriteMutation();

  const favoriteId = findFavoriteId(favoritesQuery.data, {
    kind: input.kind,
    chatId: input.chatId,
    runId: input.runId ?? null,
    artifactId: input.artifactId ?? null,
    messageId: input.messageId ?? null,
  });
  const filled = favoriteId !== null;
  const pending = addMutation.isPending || removeMutation.isPending;

  function toggle(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    if (filled && favoriteId) {
      removeMutation.mutate(favoriteId, {
        onError: (error) =>
          toast.error("즐겨찾기 해제에 실패했어요.", {
            description: error instanceof Error ? error.message : undefined,
          }),
      });
    } else {
      addMutation.mutate(input, {
        onError: (error) =>
          toast.error("즐겨찾기 추가에 실패했어요.", {
            description: error instanceof Error ? error.message : undefined,
          }),
      });
    }
  }

  const dimension = size === "md" ? "size-9" : "size-8";
  const iconSize = size === "md" ? "size-4" : "size-3.5";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            aria-pressed={filled}
            aria-label={filled ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full border transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              "disabled:cursor-not-allowed disabled:opacity-60",
              filled
                ? "border-amber-300 bg-amber-50 text-amber-500 hover:bg-amber-100"
                : "border-border/70 bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              dimension,
              className,
            )}
          />
        }
      >
        <Star
          className={cn(iconSize, filled ? "fill-current" : "")}
        />
      </TooltipTrigger>
      <TooltipContent>
        {filled ? "즐겨찾기에서 빼기" : "즐겨찾기에 추가"}
      </TooltipContent>
    </Tooltip>
  );
}
