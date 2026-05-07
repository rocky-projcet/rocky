import { Paperclip, X } from "lucide-react";

export function AttachmentChipList({
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (file: File, index: number) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((file, index) => (
        <li
          key={`${file.name}-${index}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2.5 py-1 text-xs"
        >
          <Paperclip className="size-3" />
          <span className="max-w-40 truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => onRemove(file, index)}
            aria-label={`${file.name} 제거`}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
