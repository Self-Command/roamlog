"use client";

import { parse, unparse } from "papaparse";
import { useEffect, useMemo, useState } from "react";
import DataGrid, { textEditor, type Column } from "react-data-grid";

import "react-data-grid/lib/styles.css";

const MIN_ROWS = 50;
const MIN_COLS = 26;

type Row = Record<string, string | number>;

function parseRows(content: string): string[][] {
  if (!content.trim()) {
    return Array.from({ length: MIN_ROWS }, () => Array<string>(MIN_COLS).fill(""));
  }
  const parsed = parse<string[]>(content, { skipEmptyLines: true });
  const rows = parsed.data.map((row) => {
    const padded = [...row];
    while (padded.length < MIN_COLS) padded.push("");
    return padded;
  });
  while (rows.length < MIN_ROWS) {
    rows.push(Array<string>(MIN_COLS).fill(""));
  }
  return rows;
}

function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof document === "undefined") return true;
    const mode = document.documentElement.dataset.mode;
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const mode = document.documentElement.dataset.mode;
      setDark(mode === "dark" || (mode !== "light" && media.matches));
    };
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return dark;
}

export function ArtifactSheetEditor({
  content,
  editable,
  onSave,
}: {
  content: string;
  editable: boolean;
  onSave: (content: string, debounce?: boolean) => void;
}) {
  const dark = useDarkMode();
  const columns = useMemo<Column<Row>[]>(() => {
    const rowNumber: Column<Row> = {
      cellClass: "border-t border-r",
      frozen: true,
      headerCellClass: "border-t border-r",
      key: "rowNumber",
      name: "",
      renderCell: ({ rowIdx }) => rowIdx + 1,
      width: 50,
    };
    const dataColumns = Array.from({ length: MIN_COLS }, (_, index) => ({
      cellClass: "border-t",
      headerCellClass: "border-t",
      key: String(index),
      name: String.fromCharCode(65 + index),
      renderEditCell: editable ? textEditor : undefined,
      width: 120,
    })) satisfies Column<Row>[];
    return [rowNumber, ...dataColumns];
  }, [editable]);

  const parsedRows = useMemo(() => parseRows(content), [content]);
  const initialRows = useMemo<Row[]>(
    () =>
      parsedRows.map((row, rowIndex) => {
        const record: Row = { id: rowIndex, rowNumber: rowIndex + 1 };
        columns.slice(1).forEach((column, columnIndex) => {
          record[column.key] = row[columnIndex] ?? "";
        });
        return record;
      }),
    [columns, parsedRows],
  );
  const [rows, setRows] = useState<Row[]>(initialRows);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  return (
    <div className="h-full min-h-[420px]" data-testid="artifact-sheet-editor">
      <DataGrid
        className={dark ? "rdg-dark h-full" : "rdg-light h-full"}
        columns={columns}
        defaultColumnOptions={{ resizable: true, sortable: true }}
        enableVirtualization
        onCellClick={(args) => {
          if (editable && args.column.key !== "rowNumber") args.selectCell(true);
        }}
        onRowsChange={
          editable
            ? (nextRows) => {
                setRows(nextRows);
                const csv = unparse(
                  nextRows.map((row) =>
                    columns.slice(1).map((column) => String(row[column.key] ?? "")),
                  ),
                );
                onSave(csv, true);
              }
            : undefined
        }
        rows={rows}
      />
    </div>
  );
}
