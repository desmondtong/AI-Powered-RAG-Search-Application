"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MoreIcon } from "@/app/components/icons";

export interface OverflowItem {
  id: string;
  label: string;
  /** A link opens in place of running a handler, e.g. the original file download. */
  href?: string;
  download?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

/** "···" menu button. Keyboard: Enter/Space/ArrowDown opens, arrows move, Escape closes and returns focus. */
export default function OverflowMenu({ items, label = "More actions" }: { items: OverflowItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const focusItem = (index: number) => {
    const entries = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    if (!entries || entries.length === 0) return;
    entries[(index + entries.length) % entries.length]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => focusItem(0));
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  if (items.length === 0) return null;

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const entries = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const current = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(entries.length - 1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const itemClass = (item: OverflowItem) =>
    `flex w-full items-center rounded-control px-3 py-2 text-left text-body-md ${
      item.disabled
        ? "cursor-not-allowed text-disabled-text"
        : item.destructive
          ? "text-red hover:bg-red-wash focus:bg-red-wash"
          : "text-ink hover:bg-subtle focus:bg-subtle"
    } focus:outline-none`;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="grid size-9 place-items-center rounded-control border border-hairline bg-card text-ink-secondary hover:border-hairline-strong hover:text-ink"
      >
        <MoreIcon size={18} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-40 mt-1 min-w-56 rounded-panel border border-hairline bg-raised p-1 shadow-raised"
        >
          {items.map((item) =>
            item.href && !item.disabled ? (
              <a
                key={item.id}
                role="menuitem"
                tabIndex={-1}
                href={item.href}
                download={item.download}
                onClick={() => close(false)}
                className={itemClass(item)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  if (item.disabled) return;
                  close();
                  item.onSelect?.();
                }}
                className={itemClass(item)}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
