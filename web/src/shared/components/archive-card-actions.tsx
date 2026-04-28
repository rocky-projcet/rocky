import { ArchiveRestore, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export function ArchiveCardActions({
  onDelete,
  onRestore,
  deleting,
  restoring,
  restoreLabel = "복원",
  deleteLabel = "삭제",
  restoreHint = "복원 후 다시 사용할 수 있어요.",
}: {
  onDelete: () => void;
  onRestore: () => void;
  deleting?: boolean;
  restoring?: boolean;
  restoreLabel?: string;
  deleteLabel?: string;
  restoreHint?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDelete();
              }}
              disabled={deleting}
              aria-label={deleteLabel}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            />
          }
        >
          <Trash2 className="size-4" />
        </TooltipTrigger>
        <TooltipContent>영구 삭제</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRestore();
              }}
              disabled={restoring}
            />
          }
        >
          <ArchiveRestore className="size-4" />
          {restoreLabel}
        </TooltipTrigger>
        <TooltipContent>{restoreHint} 보관함에서만 영구 삭제도 할 수 있어요.</TooltipContent>
      </Tooltip>
    </div>
  );
}
