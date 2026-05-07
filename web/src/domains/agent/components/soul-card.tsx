import { useEffect, useState, type FormEvent } from "react";
import { Heart, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";
import { agentEngineClient } from "@/shared/lib/api-client";

export function SoulCard({
  agentId,
  agentName,
  soul,
  readOnly,
  onSaved,
}: {
  agentId: string;
  agentName: string;
  soul: string | null;
  readOnly: boolean;
  onSaved: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const trimmed = soul?.trim() ?? "";

  return (
    <section className="rounded-2xl border border-border/70 bg-muted/30 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Heart className="size-4 text-muted-foreground" />
            소울 (페르소나)
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            모든 작업의 시스템 프롬프트 첫 자리에 들어가서 직원의 톤·행동을 일관되게 만들어요.
          </p>
        </div>
        {!readOnly ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Pencil className="size-3.5" />
            {trimmed ? "편집" : "정해주기"}
          </Button>
        ) : null}
      </header>

      <div className="mt-3">
        {trimmed ? (
          <pre className="whitespace-pre-wrap rounded-xl border border-border/70 bg-card px-4 py-3 font-mono text-xs leading-5 text-foreground">
            {trimmed}
          </pre>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/70 bg-card px-4 py-3 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            아직 정해진 소울이 없어요. 편집을 누르면 정체성·말투·규칙을 한 번에 적을 수 있어요.
          </div>
        )}
      </div>

      <SoulEditDialog
        agentId={agentId}
        agentName={agentName}
        initial={soul ?? ""}
        open={open}
        onOpenChange={setOpen}
        onSaved={onSaved}
      />
    </section>
  );
}

function SoulEditDialog({
  agentId,
  agentName,
  initial,
  open,
  onOpenChange,
  onSaved,
}: {
  agentId: string;
  agentName: string;
  initial: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const next = draft.trim();
      const updated = await agentEngineClient.updateAgent(agentId, {
        soul: next || null,
      });
      onSaved(updated.soul);
      onOpenChange(false);
      toast.success("소울을 저장했습니다.", { description: agentName });
    } catch (error) {
      toast.error("소울 저장에 실패했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-5 sm:max-w-2xl">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-lg">{agentName}의 소울 편집</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            마크다운으로 자유롭게 적어주세요. 정체성·말투·규칙·시그니처를 짧고 진하게 적을수록 효과가 좋아요. 비워두면 페르소나 없이 작동합니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`# 정체성\n나는 따뜻하지만 결단력 있는 마케팅 시니어이다.\n\n# 말투\n친근하고 구어체로, 결론을 먼저.\n\n# 행동 규칙\n- 모르면 모른다고 한다\n- 마지막에 다음 행동을 한 가지 제안한다`}
            className="custom-scrollbar min-h-72 max-h-[24rem] font-mono text-xs leading-6"
          />

          <DialogFooter className="flex flex-row items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              취소
            </Button>
            <Button type="submit" disabled={saving}>
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
