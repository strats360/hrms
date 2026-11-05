import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, MoreVertical, X } from "lucide-react";
import { Button } from "./button";
import { Checkbox } from "./field";
import { Menu, type MenuItem } from "./menu";
import { Spinner } from "./spinner";

export interface BulkAction<T> {
  label: string;
  onRun: (rows: T[]) => void | Promise<void>;
}

export interface ServerPaging {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface ServerSorting {
  sort: string;
  dir: "asc" | "desc";
  onSortChange: (sort: string, dir: "asc" | "desc") => void;
}

interface Props<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => MenuItem[];
  bulkActions?: BulkAction<T>[];
  pageSize?: number;
  server?: ServerPaging;
  serverSort?: ServerSorting;
  loading?: boolean;
  empty?: ReactNode;
  toolbar?: ReactNode;
  /** Persist column visibility per table in localStorage. */
  storageKey?: string;
  initialSort?: SortingState;
  columnToggle?: boolean;
}

function loadVisibility(key?: string): VisibilityState {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(`cols:${key}`) ?? "{}");
  } catch {
    return {};
  }
}

/**
 * shadcn-style data table on TanStack Table: sorting, column visibility,
 * row selection with bulk actions, pagination (client or server) and a
 * sticky row-actions menu.
 */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  onRowClick,
  rowActions,
  bulkActions,
  pageSize = 10,
  server,
  serverSort,
  loading,
  empty,
  toolbar,
  storageKey,
  initialSort = [],
  columnToggle = true,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(serverSort ? [{ id: serverSort.sort, desc: serverSort.dir === "desc" }] : initialSort);
  const [visibility, setVisibility] = useState<VisibilityState>(() => loadVisibility(storageKey));
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`cols:${storageKey}`, JSON.stringify(visibility));
    } catch {
      /* ignore */
    }
  }, [storageKey, visibility]);

  const cols = useMemo<ColumnDef<T, any>[]>(() => {
    const out: ColumnDef<T, any>[] = [];
    if (bulkActions?.length) {
      out.push({
        id: "_select",
        enableSorting: false,
        enableHiding: false,
        size: 36,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onChange={(v) => table.toggleAllPageRowsSelected(v)}
            label={<span className="sr-only">Select all</span>}
          />
        ),
        cell: ({ row }) => <Checkbox checked={row.getIsSelected()} onChange={(v) => row.toggleSelected(v)} label={<span className="sr-only">Select row</span>} />,
      });
    }
    out.push(...columns);
    if (rowActions) {
      out.push({
        id: "_actions",
        enableSorting: false,
        enableHiding: false,
        size: 44,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
            <Menu
              items={rowActions(row.original)}
              trigger={
                <button className="btn btn-ghost btn-icon !h-[30px] !w-[30px] !text-[var(--color-text)]" aria-label="Row actions">
                  <MoreVertical size={16} />
                </button>
              }
            />
          </div>
        ),
      });
    }
    return out;
  }, [columns, rowActions, bulkActions]);

  const table = useReactTable({
    data,
    columns: cols,
    getRowId,
    state: { sorting, columnVisibility: visibility, rowSelection: selection },
    onSortingChange: (u) => {
      const next = typeof u === "function" ? u(sorting) : u;
      setSorting(next);
      if (serverSort) {
        const s = next[0];
        serverSort.onSortChange(s?.id ?? serverSort.sort, s?.desc ? "desc" : "asc");
      }
    },
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: setSelection,
    enableRowSelection: !!bulkActions?.length,
    manualSorting: !!serverSort,
    manualPagination: !!server,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: serverSort ? undefined : getSortedRowModel(),
    getPaginationRowModel: server ? undefined : getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: true,
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const pageIndex = server ? server.page - 1 : table.getState().pagination.pageIndex;
  const size = server ? server.pageSize : table.getState().pagination.pageSize;
  const total = server ? server.total : data.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? pageIndex * size + 1 : 0;
  const to = Math.min((pageIndex + 1) * size, total);
  const goto = (p: number) => (server ? server.onPageChange(p + 1) : table.setPageIndex(p));
  const rows = table.getRowModel().rows;
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());

  const runBulk = async (a: BulkAction<T>) => {
    setBusy(true);
    try {
      await a.onRun(selected);
      setSelection({});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-w-0 flex-col gap-2">
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        {selected.length > 0 && bulkActions?.length ? (
          <div className="flex items-center gap-1.5 rounded-[var(--radius-md)] py-1 pl-3 pr-1.5 text-[13px]" style={{ background: "var(--sel-bg)" }}>
            <span className="font-medium">{selected.length} selected</span>
            {bulkActions.map((a) => (
              <Button key={a.label} size="sm" disabled={busy} onClick={() => runBulk(a)}>
                {a.label}
              </Button>
            ))}
            <Button variant="ghost" icon size="sm" onClick={() => setSelection({})} aria-label="Clear selection">
              <X size={14} />
            </Button>
          </div>
        ) : null}
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          {loading ? <Spinner size={14} /> : null}
          <span className="text-muted whitespace-nowrap text-[12.5px]">
            {from}–{to} of {total}
          </span>
          <Button icon size="sm" onClick={() => goto(pageIndex - 1)} disabled={pageIndex <= 0} aria-label="Previous page">
            <ChevronLeft size={16} />
          </Button>
          <Button icon size="sm" onClick={() => goto(pageIndex + 1)} disabled={pageIndex >= pages - 1} aria-label="Next page">
            <ChevronRight size={16} />
          </Button>
          {columnToggle && hideable.length > 0 ? (
            <Popover.Root>
              <Popover.Trigger asChild>
                <Button size="sm">
                  <Columns3 size={14} />
                  Columns
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={4} className="card elev-md z-50 min-w-[200px] !gap-0.5 !p-2">
                  {hideable.map((c) => (
                    <div key={c.id} className="rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[var(--tint-1)]">
                      <Checkbox checked={c.getIsVisible()} onChange={(v) => c.toggleVisibility(v)} label={<span className="text-[13px]">{typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}</span>} />
                    </div>
                  ))}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          ) : null}
        </div>
      </div>
      <div className="scroll-thin min-w-0 overflow-x-auto">
        <table className="table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  const right = (h.column.columnDef.meta as { align?: string } | undefined)?.align === "right";
                  const sticky = h.column.id === "_actions";
                  return (
                    <th
                      key={h.id}
                      style={{ width: h.column.columnDef.size && h.column.columnDef.size < 100 ? h.column.columnDef.size : undefined, textAlign: right ? "right" : "left", position: sticky ? "sticky" : undefined, right: sticky ? 0 : undefined, background: sticky ? "var(--color-surface)" : undefined, color: dir ? "var(--color-accent)" : undefined }}
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                    >
                      {sortable ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 uppercase tracking-[0.08em] text-inherit" style={{ font: "inherit" }}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? <ArrowUp size={12} /> : dir === "desc" ? <ArrowDown size={12} /> : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="text-muted !py-8 text-center text-[13px]">
                  {loading ? "Loading…" : (empty ?? "Nothing to show")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                  style={{ cursor: onRowClick ? "pointer" : undefined, backgroundColor: r.getIsSelected() ? "var(--sel-bg)" : undefined }}
                >
                  {r.getVisibleCells().map((cell) => {
                    const right = (cell.column.columnDef.meta as { align?: string } | undefined)?.align === "right";
                    const sticky = cell.column.id === "_actions";
                    return (
                      <td
                        key={cell.id}
                        className="whitespace-nowrap"
                        style={{ textAlign: right ? "right" : undefined, fontVariantNumeric: "tabular-nums", position: sticky ? "sticky" : undefined, right: sticky ? 0 : undefined, background: sticky ? "var(--color-surface)" : undefined }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
