import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Paperclip, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import type { MdTemplateDefinition } from "@/domains/template/types";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import {
  AttachmentChipList,
  DropZoneOverlay,
  useFileDropZone,
} from "@/domains/attachment";

const AUTO_VALUE = "__auto__";
const AUTO_LABEL = "스킬 자동 선택";

export interface TaskComposerSubmit {
  message: string;
  files: File[];
  skill: MdTemplateDefinition | null;
}

export function TaskComposer({
  recipientName,
  equippedSkills,
  pending,
  initialMessage = "",
  initialPinnedSkillId = null,
  onSubmit,
}: {
  recipientName: string;
  equippedSkills: MdTemplateDefinition[];
  pending: boolean;
  initialMessage?: string;
  initialPinnedSkillId?: string | null;
  onSubmit: (input: TaskComposerSubmit) => Promise<boolean> | boolean;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [files, setFiles] = useState<File[]>([]);
  const [pinnedSkillId, setPinnedSkillId] = useState<string | null>(initialPinnedSkillId);
  const [submitPending, setSubmitPending] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const pinnedSkill = equippedSkills.find((skill) => skill.id === pinnedSkillId) ?? null;
  const submitIsPending = pending || submitPending;

  useEffect(() => {
    if (initialPinnedSkillId) {
      textareaRef.current?.focus();
    }
  }, [initialPinnedSkillId]);

  function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files ?? []);
    if (next.length === 0) return;
    appendFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function appendFiles(next: File[]) {
    if (next.length === 0) return;
    setFiles((current) => [...current, ...next]);
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  const { isDragging, handlers: dropHandlers } = useFileDropZone({
    onFiles: appendFiles,
    disabled: submitIsPending,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitIsPending) return;
    const trimmed = message.trim();
    if (!trimmed && !pinnedSkill) {
      toast.warning("부탁할 내용을 적어주세요.");
      return;
    }

    const submittedMessage = message;
    const submittedFiles = files;
    const submittedPinnedSkillId = pinnedSkillId;
    const submittedPinnedSkill = pinnedSkill;
    setMessage("");
    setFiles([]);
    setPinnedSkillId(null);
    setSubmitPending(true);

    try {
      const submitted = await onSubmit({
        message: trimmed,
        files: submittedFiles,
        skill: submittedPinnedSkill,
      });
      if (!submitted) {
        setMessage((current) =>
          current.trim().length > 0 ? current : submittedMessage
        );
        setFiles(submittedFiles);
        setPinnedSkillId(submittedPinnedSkillId);
      }
    } catch {
      setMessage((current) =>
        current.trim().length > 0 ? current : submittedMessage
      );
      setFiles(submittedFiles);
      setPinnedSkillId(submittedPinnedSkillId);
    } finally {
      setSubmitPending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    const form = event.currentTarget.closest("form");
    form?.requestSubmit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      onDragEnter={dropHandlers.onDragEnter}
      onDragOver={dropHandlers.onDragOver}
      onDragLeave={dropHandlers.onDragLeave}
      onDrop={dropHandlers.onDrop}
      className={cn(
        "relative shrink-0 rounded-2xl border bg-card p-3 shadow-sm transition",
        isFocused || isDragging
          ? "border-foreground/15 ring-2 ring-ring/10"
          : "border-border/70",
      )}
    >
      <DropZoneOverlay visible={isDragging} />

      {pinnedSkill ? (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-1.5 text-xs text-foreground">
          <Sparkles className="size-3.5 text-muted-foreground" />
          <span className="font-medium">스킬:</span>
          <span className="truncate">{pinnedSkill.title}</span>
          <button
            type="button"
            onClick={() => setPinnedSkillId(null)}
            aria-label="스킬 고정 해제"
            className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="mb-2">
          <AttachmentChipList files={files} onRemove={(_, index) => removeFile(index)} />
        </div>
      ) : null}

      <Textarea
        ref={textareaRef}
        value={message}
        disabled={submitIsPending}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={
          pinnedSkill
            ? `${pinnedSkill.title}로 ${recipientName}에게 부탁할 내용을 적어주세요`
            : `${recipientName}에게 자연어로 일을 부탁해보세요. 장착된 스킬을 알아서 골라 사용해요.`
        }
        className="custom-scrollbar max-h-40 min-h-[3.5rem] resize-none overflow-y-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
      />

      <div className="mt-2 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={handleFilesChange}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={submitIsPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
          파일
        </Button>

        {equippedSkills.length > 0 ? (
          <SkillPinSelect
            options={equippedSkills}
            value={pinnedSkillId}
            onChange={setPinnedSkillId}
            disabled={submitIsPending}
          />
        ) : null}

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="submit"
                className="ml-auto"
                disabled={submitIsPending || (!message.trim() && !pinnedSkill)}
              >
                {submitIsPending ? (
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-card/30 border-t-card bg-transparent p-0"
                  />
                ) : (
                  <Send className="size-4" />
                )}
                실행하기
              </Button>
            }
          />
          <TooltipContent>Enter를 누르면 바로 실행됩니다 (Shift + Enter는 줄바꿈)</TooltipContent>
        </Tooltip>
      </div>
    </form>
  );
}

function SkillPinSelect({
  options,
  value,
  onChange,
  disabled,
}: {
  options: MdTemplateDefinition[];
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const pinned = value ? options.find((option) => option.id === value) ?? null : null;
  const displayLabel = pinned ? pinned.title : AUTO_LABEL;

  return (
    <Select
      value={value ?? AUTO_VALUE}
      onValueChange={(next) => onChange(next === AUTO_VALUE ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label="이 작업에 사용할 스킬 고정"
        className="min-w-[10rem]"
      >
        <SelectValue>{displayLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO_VALUE}>{AUTO_LABEL}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function composeSkillRunPrompt(
  skill: MdTemplateDefinition,
  brief: string,
  fileNames: string[],
): string {
  const userBrief = composeFreeFormPrompt(
    brief || `${skill.title}로 진행해줘.`,
    fileNames,
  ).trim();
  return `${skill.skill.invocation}${userBrief ? `\n\n${userBrief}` : ""}`;
}

export function composeFreeFormPrompt(brief: string, fileNames: string[]): string {
  if (fileNames.length === 0) return brief;
  const fileList = fileNames.map((name) => `- ${name}`).join("\n");
  return `${brief}\n\n첨부:\n${fileList}`;
}
