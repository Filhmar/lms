"use client";

/**
 * Desktop components — the DSK additions from the Desktop Views export:
 * data table (sticky header · sortable · selectable + bulk bar), tree view
 * (↑↓←→ keyboard), anchored popover, dropdown menu, toolbar pieces,
 * pagination, dropzone, tooltip, dialog scaffold, kbd chip.
 * All styling lives in styles.css as rl-* classes.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

/* ============================= checkbox ============================= */

export interface CheckboxProps {
  checked: boolean;
  /** Header/bulk indeterminate state (select-all-on-page, partial). */
  mixed?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  large?: boolean;
  disabled?: boolean;
}

export function Checkbox({ checked, mixed, onChange, label, large, disabled }: CheckboxProps) {
  const cls = `rl-checkbox${mixed ? " rl-checkbox--mixed" : checked ? " rl-checkbox--checked" : ""}${large ? " rl-checkbox--lg" : ""}`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      className={cls}
      onClick={(e) => {
        e.stopPropagation();
        onChange(mixed ? false : !checked);
      }}
    >
      {mixed ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 12h12" stroke="#fff" strokeWidth={3} strokeLinecap="round" />
        </svg>
      ) : checked ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 12.5l4.7 4.7L19.5 7" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </button>
  );
}

/* ============================= data table ============================= */

export type SortDir = "asc" | "desc";
export interface TableSort {
  key: string;
  dir: SortDir;
}

export interface DataTableColumn<T> {
  key: string;
  label: ReactNode;
  /** CSS grid track, e.g. "2.2fr" or "44px". */
  width: string;
  sortable?: boolean;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  "aria-label": string;
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** Rendered INSTEAD of the header row while ≥1 row is checked (§2.2). */
  bulkBar?: ReactNode;
  /** Enter / row click. */
  onRowOpen?: (row: T) => void;
  /** Trailing ⋯ cell content per row (see MeatballMenu). */
  rowMenu?: (row: T) => ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  maxBodyHeight?: number;
}

function SortArrow({ dir }: { dir: SortDir }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ color: "var(--color-primary)", transform: dir === "desc" ? "rotate(180deg)" : undefined }}
    >
      <path d="M12 5v14" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M7 10l5-5 5 5" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  selectable,
  selected,
  onSelectedChange,
  bulkBar,
  onRowOpen,
  rowMenu,
  empty,
  footer,
  maxBodyHeight,
  "aria-label": ariaLabel,
}: DataTableProps<T>) {
  const grid = [
    ...(selectable ? ["44px"] : []),
    ...columns.map((c) => c.width),
    ...(rowMenu ? ["44px"] : []),
  ].join(" ");

  const sel = selected ?? new Set<string>();
  const keys = rows.map(rowKey);
  const allChecked = keys.length > 0 && keys.every((k) => sel.has(k));
  const someChecked = keys.some((k) => sel.has(k));

  const toggleAll = (next: boolean) => {
    if (!onSelectedChange) return;
    const out = new Set(sel);
    for (const k of keys) {
      if (next) out.add(k);
      else out.delete(k);
    }
    onSelectedChange(out);
  };
  const toggleOne = (key: string, next: boolean) => {
    if (!onSelectedChange) return;
    const out = new Set(sel);
    if (next) out.add(key);
    else out.delete(key);
    onSelectedChange(out);
  };

  /* roving focus over body rows: ↑↓ move · Space checkbox · Enter open */
  const bodyRef = useRef<HTMLDivElement>(null);
  const onRowKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, row: T, index: number) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? index + 1 : index - 1;
      const el = bodyRef.current?.querySelector<HTMLElement>(`[data-row-index="${next}"]`);
      el?.focus();
    } else if (e.key === " " && selectable) {
      e.preventDefault();
      const k = rowKey(row);
      toggleOne(k, !sel.has(k));
    } else if (e.key === "Enter" && onRowOpen) {
      e.preventDefault();
      onRowOpen(row);
    }
  };

  return (
    <div className="rl-table" role="group" aria-label={ariaLabel}>
      {bulkBar && someChecked ? (
        bulkBar
      ) : (
        <div className="rl-table__head" style={{ gridTemplateColumns: grid }}>
          {selectable ? (
            <span className="rl-table__cell" style={{ display: "inline-flex" }}>
              <Checkbox
                checked={allChecked}
                mixed={!allChecked && someChecked}
                onChange={toggleAll}
                label="Select all rows on this page"
              />
            </span>
          ) : null}
          {columns.map((c) => {
            const isSorted = sort?.key === c.key;
            if (!c.sortable || !onSortChange) {
              return (
                <span key={c.key} className="rl-table__hcell" style={c.align === "right" ? { justifyContent: "flex-end" } : undefined}>
                  {c.label}
                </span>
              );
            }
            return (
              <button
                key={c.key}
                type="button"
                className={`rl-table__hcell${isSorted ? " rl-table__hcell--sorted" : ""}`}
                aria-sort={isSorted ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                onClick={() =>
                  onSortChange({ key: c.key, dir: isSorted && sort!.dir === "asc" ? "desc" : "asc" })
                }
              >
                {c.label}
                {isSorted ? <SortArrow dir={sort!.dir} /> : null}
              </button>
            );
          })}
          {rowMenu ? <span /> : null}
        </div>
      )}

      <div
        className="rl-table__scroll"
        ref={bodyRef}
        style={maxBodyHeight ? ({ "--rl-table-max-height": `${maxBodyHeight}px` } as CSSProperties) : undefined}
      >
        {rows.length === 0 && empty ? empty : null}
        {rows.map((row, i) => {
          const k = rowKey(row);
          const isSel = sel.has(k);
          return (
            <div
              key={k}
              data-row-index={i}
              tabIndex={i === 0 ? 0 : -1}
              className={`rl-table__row${onRowOpen ? " rl-table__row--hoverable" : ""}${isSel ? " rl-table__row--selected" : ""}`}
              style={{ gridTemplateColumns: grid }}
              onKeyDown={(e) => onRowKeyDown(e, row, i)}
              onClick={onRowOpen ? () => onRowOpen(row) : undefined}
            >
              {selectable ? (
                <span className="rl-table__cell" style={{ display: "inline-flex" }}>
                  <Checkbox checked={isSel} onChange={(next) => toggleOne(k, next)} label={`Select row ${i + 1}`} />
                </span>
              ) : null}
              {columns.map((c) => (
                <span
                  key={c.key}
                  className={`rl-table__cell${c.align === "right" ? " rl-table__cell--right" : ""}`}
                >
                  {c.render(row)}
                </span>
              ))}
              {rowMenu ? (
                <span
                  className="rl-table__cell"
                  style={{ display: "inline-flex", justifyContent: "flex-end" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {rowMenu(row)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}

/* ============================= bulk bar ============================= */

export function BulkBar({
  count,
  onClear,
  children,
  onToggleAll,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
  onToggleAll?: (next: boolean) => void;
}) {
  return (
    <div className="rl-bulkbar" role="toolbar" aria-label={`${count} selected — bulk actions`}>
      {onToggleAll ? (
        <Checkbox large mixed checked onChange={() => onToggleAll(false)} label="Clear selection" />
      ) : null}
      <span className="rl-bulkbar__count rl-num">{count} selected</span>
      <span className="rl-bulkbar__divider" aria-hidden />
      {children}
      <button type="button" className="rl-bulkbar__clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

export function BulkPill({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="rl-bulkbar__pill" onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  );
}

/* ============================= tree view ============================= */

export interface TreeItem {
  id: string;
  label: ReactNode;
  /** Plain-text name for aria labels. */
  name: string;
  /** Muted = above-scope ancestor: orientation only, never selectable. */
  muted?: boolean;
  badge?: ReactNode;
  /** Trailing count on collapsed siblings. */
  meta?: ReactNode;
  children?: TreeItem[];
  /** True when the node can expand but children load lazily. */
  canExpand?: boolean;
}

export interface TreeViewProps {
  items: TreeItem[];
  expanded: ReadonlySet<string>;
  onToggle: (id: string, willExpand: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  "aria-label": string;
  loadingIds?: ReadonlySet<string>;
}

function TreeChevron({ open }: { open: boolean }) {
  return (
    <span className="rl-tree__chevron" aria-hidden>
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        style={{ transform: open ? "rotate(90deg)" : undefined }}
      >
        <path d="M8 5l7 7-7 7" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

interface FlatNode {
  item: TreeItem;
  depth: number;
  parentId: string | null;
}

function flattenVisible(items: TreeItem[], expanded: ReadonlySet<string>, depth = 0, parentId: string | null = null): FlatNode[] {
  const out: FlatNode[] = [];
  for (const item of items) {
    out.push({ item, depth, parentId });
    if (expanded.has(item.id) && item.children) {
      out.push(...flattenVisible(item.children, expanded, depth + 1, item.id));
    }
  }
  return out;
}

export function TreeView({
  items,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  loadingIds,
  "aria-label": ariaLabel,
}: TreeViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const flat = flattenVisible(items, expanded);
  const focusNode = (id: string) => {
    rootRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, node: FlatNode, index: number) => {
    const { item } = node;
    const expandable = Boolean(item.children?.length) || item.canExpand;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = flat[e.key === "ArrowDown" ? index + 1 : index - 1];
      if (next) focusNode(next.item.id);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (expandable && !expanded.has(item.id)) onToggle(item.id, true);
      else {
        const next = flat[index + 1];
        if (next && next.parentId === item.id) focusNode(next.item.id);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (expandable && expanded.has(item.id)) onToggle(item.id, false);
      else if (node.parentId) focusNode(node.parentId);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!item.muted) onSelect(item.id);
    }
  };

  const renderLevel = (levelItems: TreeItem[], depth: number): ReactNode =>
    levelItems.map((item) => {
      const expandable = Boolean(item.children?.length) || item.canExpand;
      const isOpen = expanded.has(item.id);
      const index = flat.findIndex((f) => f.item.id === item.id);
      const selected = item.id === selectedId;
      const loading = loadingIds?.has(item.id);
      return (
        <div key={item.id} role="none">
          <button
            type="button"
            role="treeitem"
            data-tree-id={item.id}
            aria-expanded={expandable ? isOpen : undefined}
            aria-selected={selected}
            aria-label={item.name}
            aria-disabled={item.muted || undefined}
            tabIndex={index === 0 ? 0 : -1}
            className={`rl-tree__node${item.muted ? " rl-tree__node--muted" : ""}${selected ? " rl-tree__node--selected" : ""}`}
            onKeyDown={(e) => onKeyDown(e, { item, depth, parentId: flat[index]?.parentId ?? null }, index)}
            onClick={() => {
              if (item.muted) return;
              onSelect(item.id);
              if (expandable && !isOpen) onToggle(item.id, true);
            }}
          >
            {expandable ? (
              <span
                role="none"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(item.id, !isOpen);
                }}
                style={{ display: "inline-flex" }}
              >
                <TreeChevron open={isOpen} />
              </span>
            ) : (
              <span style={{ width: 11, flexShrink: 0 }} aria-hidden />
            )}
            <span className="rl-tree__label">{item.label}</span>
            {loading ? <span className="rl-tree__count">…</span> : null}
            {selected && item.badge !== undefined ? (
              <span className="rl-tree__badge rl-num">{item.badge}</span>
            ) : !selected && item.meta !== undefined ? (
              <span className="rl-tree__count rl-num">{item.meta}</span>
            ) : null}
          </button>
          {isOpen && item.children && item.children.length > 0 ? (
            <div role="group" className="rl-tree__children">
              {renderLevel(item.children, depth + 1)}
            </div>
          ) : null}
        </div>
      );
    });

  return (
    <div ref={rootRef} role="tree" aria-label={ariaLabel} className="rl-tree">
      {renderLevel(items, 0)}
    </div>
  );
}

/* ============================= popover ============================= */

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Anchor side within a position:relative wrapper. */
  align?: "left" | "right";
  width?: number;
  caret?: boolean;
  "aria-label": string;
}

/** Closes on outside-click / Esc; restores focus to the trigger. */
export function Popover({ open, onClose, children, align = "right", width = 340, caret = true, "aria-label": ariaLabel }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      className="rl-popover"
      style={{
        top: "calc(100% + 9px)",
        width,
        maxWidth: "calc(100vw - 24px)",
        ...(align === "right" ? { right: 0 } : { left: 0 }),
        outline: "none",
      }}
    >
      {caret ? <div className="rl-popover__caret" style={align === "right" ? { right: 26 } : { left: 26 }} aria-hidden /> : null}
      {children}
    </div>
  );
}

/* ============================= dropdown menu ============================= */

export interface MenuItemDef {
  key: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** ⋯ trigger + role="menu" dropdown; ↑↓ + Enter, Esc returns focus. */
export function MeatballMenu({ items, label }: { items: MenuItemDef[]; label: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const first = wrapRef.current?.querySelector<HTMLElement>(".rl-menu__item:not([disabled])");
    first?.focus();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(
      wrapRef.current?.querySelectorAll<HTMLElement>(".rl-menu__item:not([disabled])") ?? [],
    );
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      nodes[(i + 1) % nodes.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const normal = items.filter((i) => !i.destructive);
  const destructive = items.filter((i) => i.destructive);

  const renderItem = (item: MenuItemDef) => (
    <button
      key={item.key}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      className={`rl-menu__item${item.destructive ? " rl-menu__item--destructive" : ""}`}
      onClick={() => {
        close();
        item.onSelect();
      }}
    >
      {item.icon}
      {item.label}
    </button>
  );

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        className={`rl-meatball${open ? " rl-meatball--open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="rl-menu"
          style={{ top: "calc(100% + 6px)", right: 0 }}
          onKeyDown={onMenuKeyDown}
        >
          {normal.map(renderItem)}
          {destructive.length > 0 ? <div className="rl-menu__divider" role="separator" /> : null}
          {destructive.map(renderItem)}
        </div>
      ) : null}
    </div>
  );
}

/* ============================= toolbar pieces ============================= */

export function SearchField({
  value,
  onChange,
  placeholder,
  width,
  hotkey,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  width?: number;
  /** Marks this field as the `/` target for the global hotkey. */
  hotkey?: boolean;
  "aria-label"?: string;
}) {
  return (
    <label className="rl-search" style={width ? { width } : undefined}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth={2.2} />
        <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        {...(hotkey ? { "data-hotkey-search": "true" } : {})}
      />
    </label>
  );
}

/** Filter chip wrapping a native select — active filter goes primary. */
export function FilterSelect({
  prefix,
  value,
  display,
  onChange,
  options,
  active,
}: {
  prefix: string;
  value: string;
  /** Text shown after the prefix, e.g. "All". */
  display: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  active?: boolean;
}) {
  return (
    <span className={`rl-filterchip${active ? " rl-filterchip--active" : ""}`}>
      {prefix}: {display}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <select
        className="rl-filterchip__select"
        aria-label={prefix}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/* ============================= pagination ============================= */

export function Pagination({
  page,
  pageCount,
  onPage,
  pageSize,
  onPageSize,
  rangeLabel,
  pageSizes = [10, 20, 50],
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  pageSize?: number;
  onPageSize?: (n: number) => void;
  rangeLabel: string;
  pageSizes?: number[];
}) {
  /* current ±1 window with first/last + gaps */
  const pages: (number | "gap")[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== "gap") pages.push("gap");
  }
  return (
    <nav className="rl-pagination" aria-label="Pagination">
      {pageSize !== undefined && onPageSize ? (
        <>
          <span>Rows per page</span>
          <select
            className="rl-pagination__select"
            value={pageSize}
            aria-label="Rows per page"
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {pageSizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <span className="rl-pagination__range rl-num">{rangeLabel}</span>
      <span style={{ display: "inline-flex", gap: 5 }}>
        <button type="button" className="rl-pager" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          ‹
        </button>
        {pages.map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="rl-pager rl-pager--gap" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`rl-pager${p === page ? " rl-pager--current" : ""}`}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className="rl-pager" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
          ›
        </button>
      </span>
    </nav>
  );
}

/* ============================= dropzone ============================= */

export function Dropzone({
  onFile,
  accept,
  title,
  meta,
  disabled,
}: {
  onFile: (file: File) => void;
  accept: string;
  /** Idle title; "browse" styling is up to the caller via this node. */
  title: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`rl-dropzone${over ? " rl-dropzone--over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <span className="rl-dropzone__disc">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 15.5V4.5" stroke="currentColor" strokeWidth={over ? 2.4 : 2.2} strokeLinecap="round" />
          <path d="M7.5 9L12 4.5 16.5 9" stroke="currentColor" strokeWidth={over ? 2.4 : 2.2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 15v4.5h14V15" stroke="currentColor" strokeWidth={over ? 2.4 : 2.2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {over ? (
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--color-primary)", marginTop: 10 }}>
          Release to upload
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 10 }}>{title}</div>
          {meta ? (
            <div style={{ fontSize: 11, color: "var(--color-ink-subtle)", marginTop: 4 }}>{meta}</div>
          ) : null}
        </>
      )}
    </label>
  );
}

/* ============================= tooltip ============================= */

/** Hover + keyboard focus after 400ms; never the only label (aria-label
    stays on the trigger). Dismisses on blur / Esc / leave. */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(true), 400);
  };
  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setShow(false);
  }, []);
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") disarm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, disarm]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <span
      className="rl-tooltip-wrap"
      onMouseEnter={arm}
      onMouseLeave={disarm}
      onFocus={arm}
      onBlur={disarm}
    >
      {children}
      {show ? (
        <span role="tooltip" className="rl-tooltip">
          {label}
        </span>
      ) : null}
    </span>
  );
}

/* ============================= dialog scaffold ============================= */

/** Centered dialog: scrim, focus-trapped, Esc + scrim click close, focus
    lands on [data-autofocus] (the safe action) or the panel itself. */
export function Dialog({
  label,
  onClose,
  children,
  width = 400,
  form,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  form?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const auto = panel?.querySelector<HTMLElement>("[data-autofocus]");
    (auto ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab" && panel) {
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="rl-dialog-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`rl-dialog${form ? " rl-dialog--form" : ""}`}
        style={{ width, outline: "none" }}
      >
        {children}
      </div>
    </div>
  );
}

/* ============================= kbd chip ============================= */

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rl-kbd">{children}</kbd>;
}
