"use client";

import { Menu } from "@base-ui/react/menu";
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

const ITEM = "flex w-full cursor-default select-none items-center rounded-control px-3 py-2 text-left text-body-md outline-none";

function itemClass(item: OverflowItem) {
  if (item.disabled) return `${ITEM} cursor-not-allowed text-disabled-text`;
  return item.destructive ? `${ITEM} text-red data-highlighted:bg-red-wash` : `${ITEM} text-ink data-highlighted:bg-subtle`;
}

/**
 * "···" menu button on Base UI Menu (design Decision 7). Non-modal so the page keeps scrolling and the row's other
 * controls stay usable. Keyboard: Enter, Space and ArrowDown open; arrows, Home and End move; Escape closes and
 * returns focus to the button. The rendered roles (`button` with `aria-haspopup="menu"`, `menu`, `menuitem`) and
 * names are the same as before the migration.
 */
export default function OverflowMenu({ items, label = "More actions" }: { items: OverflowItem[]; label?: string }) {
  if (items.length === 0) return null;

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label={label}
        className="grid size-9 place-items-center rounded-control border border-hairline bg-card text-ink-secondary hover:border-hairline-strong hover:text-ink data-popup-open:border-hairline-strong data-popup-open:text-ink"
      >
        <MoreIcon size={18} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-40 outline-none">
          <Menu.Popup aria-label={label} className="min-w-56 rounded-panel border border-hairline bg-raised p-1 shadow-raised outline-none">
            {items.map((item) =>
              item.href && !item.disabled ? (
                <Menu.LinkItem key={item.id} href={item.href} download={item.download} className={itemClass(item)}>
                  {item.label}
                </Menu.LinkItem>
              ) : (
                <Menu.Item key={item.id} disabled={item.disabled} onClick={() => item.onSelect?.()} className={itemClass(item)}>
                  {item.label}
                </Menu.Item>
              ),
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
