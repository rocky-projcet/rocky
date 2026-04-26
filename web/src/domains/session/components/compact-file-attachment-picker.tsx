import { Paperclip, X } from "lucide-react";
import { useRef, type ChangeEvent } from "react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { fileIdentity, formatFileSize } from "@/domains/session/lib/attachment-files";

export function CompactFileAttachmentPicker(props: {
  files: File[];
  disabled?: boolean;
  buttonLabel?: string;
  helperText?: string;
  fileMetaSuffix?: string;
  className?: string;
  inline?: boolean;
  showFileList?: boolean;
  iconOnly?: boolean;
  onFilesSelected: (files: File[]) => void;
  onRemoveFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (nextFiles.length === 0) {
      return;
    }

    props.onFilesSelected(nextFiles);
  }

  return (
    <div className={cn("min-w-0", props.className)}>
      <input
        ref={inputRef}
        type="file"
        multiple
        data-testid="compact-file-attachment-input"
        aria-label={props.buttonLabel ?? "파일 추가"}
        onChange={handleSelect}
        disabled={props.disabled}
        className="hidden"
      />

      <div
        className={cn(
          "items-center gap-2 text-[11px]",
          props.inline ? "inline-flex whitespace-nowrap" : "flex flex-wrap"
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={props.buttonLabel ?? "파일 추가"}
          disabled={props.disabled}
          onClick={() => inputRef.current?.click()}
          title={props.buttonLabel ?? "파일 추가"}
          className={cn(
            "h-8 rounded-full text-[11px] font-medium",
            props.iconOnly ? "w-8 px-0" : "px-3"
          )}
        >
          <Paperclip size={14} />
          {props.iconOnly ? null : props.buttonLabel ?? "파일 추가"}
        </Button>
        {props.iconOnly ? null : (
          <span className="truncate text-[11px] text-muted-foreground">
            {props.files.length > 0
              ? `${props.files.length}개 첨부됨`
              : props.helperText ?? "이미지, 문서, 코드 파일"}
          </span>
        )}
      </div>

      {props.showFileList !== false && props.files.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {props.files.map((file) => (
            <div
              key={fileIdentity(file)}
              className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border/70 bg-muted/60 px-3 py-1.5 text-[11px]"
            >
              <div className="min-w-0">
                <span className="block truncate font-medium text-foreground">{file.name}</span>
                <span className="block text-muted-foreground">
                  {formatFileSize(file.size)}
                  {props.fileMetaSuffix ? ` · ${props.fileMetaSuffix}` : ""}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`${file.name} 제거`}
                disabled={props.disabled}
                onClick={() => props.onRemoveFile(file)}
                className="shrink-0 rounded-full"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
