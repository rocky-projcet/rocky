import { useCallback, useRef, useState, type DragEvent } from "react";

interface UseFileDropZoneOptions {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export interface FileDropZoneHandlers {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export function useFileDropZone({
  onFiles,
  disabled = false,
}: UseFileDropZoneOptions): {
  isDragging: boolean;
  handlers: FileDropZoneHandlers;
} {
  const [isDragging, setIsDragging] = useState(false);
  const counterRef = useRef(0);

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      counterRef.current += 1;
      setIsDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.dataTransfer.dropEffect = "copy";
      } catch {
        // some browsers throw when dropEffect is set repeatedly
      }
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      counterRef.current = Math.max(0, counterRef.current - 1);
      if (counterRef.current === 0) {
        setIsDragging(false);
      }
    },
    [disabled],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      counterRef.current = 0;
      setIsDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      onFiles(files);
    },
    [disabled, onFiles],
  );

  return {
    isDragging,
    handlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}

function hasFiles(event: DragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  for (let index = 0; index < types.length; index += 1) {
    if (types[index] === "Files" || types[index] === "application/x-moz-file") {
      return true;
    }
  }
  return false;
}
