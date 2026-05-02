import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  parseXlsxPreview,
  type XlsxPreviewSheet,
} from "@/shared/lib/xlsx-preview";
import { cn } from "@/shared/lib/utils";

function columnName(index: number): string {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

function XlsxSheetTable({ sheet }: { sheet: XlsxPreviewSheet }) {
  const visibleColumnCount = Math.min(
    Math.max(sheet.columnCount, ...sheet.rows.map((row) => row.length), 1),
    50
  );

  return (
    <div className="h-full overflow-auto bg-white">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
          <tr>
            <th className="sticky left-0 z-20 w-12 border-b border-r bg-muted px-2 py-2 text-right font-medium">
              #
            </th>
            {Array.from({ length: visibleColumnCount }, (_, index) => (
              <th
                key={index}
                className="min-w-28 border-b border-r px-2 py-2 text-left font-medium"
              >
                {columnName(index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-background even:bg-muted/20">
              <th className="sticky left-0 z-10 border-b border-r bg-inherit px-2 py-1.5 text-right font-medium text-muted-foreground">
                {rowIndex + 1}
              </th>
              {Array.from({ length: visibleColumnCount }, (_, columnIndex) => (
                <td
                  key={columnIndex}
                  className="max-w-56 truncate border-b border-r px-2 py-1.5 text-foreground"
                  title={row[columnIndex] ?? ""}
                >
                  {row[columnIndex] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.truncatedRows || sheet.truncatedColumns ? (
        <div className="sticky bottom-0 border-t bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          큰 파일이라 처음 {Math.min(sheet.rowCount, 200)}행,
          {Math.min(sheet.columnCount, 50)}열까지만 표시합니다.
        </div>
      ) : null}
    </div>
  );
}

export function XlsxWorkbookPreview({
  className,
  sourceHref,
}: {
  className?: string;
  sourceHref: string;
}) {
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const workbookQuery = useQuery({
    queryKey: ["xlsx-workbook-preview", sourceHref],
    queryFn: async () => {
      const response = await fetch(sourceHref);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return parseXlsxPreview(await response.arrayBuffer());
    },
  });
  const workbook = workbookQuery.data ?? null;
  const selectedSheet =
    workbook?.sheets[selectedSheetIndex] ?? workbook?.sheets[0] ?? null;

  useEffect(() => {
    if (!workbook || workbook.sheets[selectedSheetIndex]) {
      return;
    }
    setSelectedSheetIndex(0);
  }, [selectedSheetIndex, workbook]);

  if (workbookQuery.isLoading) {
    return (
      <div
        className={cn(
          "flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground",
          className
        )}
      >
        엑셀 파일을 읽는 중입니다.
      </div>
    );
  }

  if (workbookQuery.isError) {
    return (
      <div
        className={cn(
          "flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground",
          className
        )}
      >
        엑셀 파일을 표로 읽지 못했습니다.
      </div>
    );
  }

  if (!workbook || workbook.sheets.length === 0 || !selectedSheet) {
    return (
      <div
        className={cn(
          "flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground",
          className
        )}
      >
        표시할 시트가 없습니다.
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-white", className)}>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-background px-3 py-2">
        {workbook.sheets.map((sheet, index) => (
          <button
            key={`${sheet.name}:${index}`}
            type="button"
            onClick={() => setSelectedSheetIndex(index)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
              selectedSheetIndex === index
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {sheet.name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <XlsxSheetTable sheet={selectedSheet} />
      </div>
    </div>
  );
}
