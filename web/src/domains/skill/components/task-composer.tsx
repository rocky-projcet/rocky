import {
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
  onSubmit: (input: TaskComposerSubmit) => Promise<void> | void;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [files, setFiles] = useState<File[]>([]);
  const [pinnedSkillId, setPinnedSkillId] = useState<string | null>(initialPinnedSkillId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pinnedSkill = equippedSkills.find((skill) => skill.id === pinnedSkillId) ?? null;

  function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files ?? []);
    if (next.length === 0) return;
    setFiles((current) => [...current, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const trimmed = message.trim();
    if (!trimmed && !pinnedSkill) {
      toast.warning("부탁할 내용을 적어주세요.");
      return;
    }
    await onSubmit({ message: trimmed, files, skill: pinnedSkill });
    setMessage("");
    setFiles([]);
    setPinnedSkillId(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      const form = event.currentTarget.closest("form");
      form?.requestSubmit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="shrink-0 rounded-2xl border border-border/70 bg-card p-3 shadow-sm"
    >
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
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2.5 py-1 text-xs"
            >
              <Paperclip className="size-3" />
              <span className="max-w-40 truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(index)}
                aria-label={`${file.name} 제거`}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          pinnedSkill
            ? `${pinnedSkill.title}로 ${recipientName}에게 부탁할 내용을 적어주세요`
            : `${recipientName}에게 자연어로 일을 부탁해보세요. 장착된 스킬을 알아서 골라 사용해요.`
        }
        className="min-h-[3.5rem] resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
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
          />
        ) : null}

        <Button
          type="submit"
          className="ml-auto"
          disabled={pending || (!message.trim() && !pinnedSkill)}
        >
          <Send className="size-4" />
          보내기
        </Button>
      </div>
    </form>
  );
}

function SkillPinSelect({
  options,
  value,
  onChange,
}: {
  options: MdTemplateDefinition[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const pinned = value ? options.find((option) => option.id === value) ?? null : null;
  const displayLabel = pinned ? pinned.title : AUTO_LABEL;

  return (
    <Select
      value={value ?? AUTO_VALUE}
      onValueChange={(next) => onChange(next === AUTO_VALUE ? null : next)}
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
  const lines = [
    "[Rocky 스킬 실행]",
    "",
    `스킬: ${skill.title}`,
    `목표: ${skill.description}`,
    "",
    "선택한 파일:",
    fileNames.length > 0 ? fileNames.map((name) => `- ${name}`).join("\n") : "- 아직 없음",
    "",
    "추가 요청:",
    brief.trim() || "특이사항 없음",
  ];
  return lines.join("\n");
}

export function composeFreeFormPrompt(brief: string, fileNames: string[]): string {
  if (fileNames.length === 0) return brief;
  const fileList = fileNames.map((name) => `- ${name}`).join("\n");
  return `${brief}\n\n첨부:\n${fileList}`;
}
