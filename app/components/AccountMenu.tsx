"use client";

import { Menu } from "@base-ui/react/menu";
import Link from "next/link";
import type { AccountIdentity } from "@/app/lib/experience/workspace/account";
import { ACCOUNT_MENU } from "@/app/lib/experience/workspace/copy";
import { PersonIcon } from "./icons";
import { useLeaveGuard } from "./LeaveGuardProvider";

const AVATAR = "grid size-8 shrink-0 place-items-center rounded-full";
const SETTINGS_HREF = "/settings";

/** Holds the avatar's place while the identity streams in, so the top bar does not shift. */
export function AvatarPlaceholder() {
  return <span aria-hidden className={`${AVATAR} border border-hairline bg-subtle`} />;
}

/**
 * The top bar's account avatar and menu (add-account-settings-and-help, design Decision 2). The identity comes from
 * IAP and is shown only; there is deliberately no sign-out. Without an identity (local runs) the avatar is neutral and
 * the menu offers Settings alone. Built like `OverflowMenu`: non-modal Base UI Menu, Escape returns focus.
 */
export default function AccountMenu({ identity }: { identity: AccountIdentity | null }) {
  const { intercept } = useLeaveGuard();
  const label = identity ? ACCOUNT_MENU.signedInLabel(identity.email) : ACCOUNT_MENU.anonymousLabel;

  const settings = (
    <Menu.LinkItem
      closeOnClick
      render={
        <Link
          href={SETTINGS_HREF}
          // Held while the open page has unsaved edits, like every other top-bar link.
          onNavigate={(event) => {
            if (intercept(SETTINGS_HREF)) event.preventDefault();
          }}
        />
      }
      className="flex w-full cursor-default select-none items-center rounded-control px-3 py-2 text-left text-body-md text-ink outline-none data-highlighted:bg-subtle"
    >
      {ACCOUNT_MENU.settings}
    </Menu.LinkItem>
  );

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label={label}
        className={`${AVATAR} ${
          identity?.initial
            ? "bg-cobalt font-heading text-label-md text-on-cobalt hover:bg-cobalt-hover"
            : "border border-hairline bg-subtle text-ink-secondary hover:border-hairline-strong hover:text-ink"
        }`}
      >
        {identity?.initial ? <span aria-hidden>{identity.initial}</span> : <PersonIcon size={18} />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-40 outline-none">
          <Menu.Popup aria-label={label} className="min-w-56 max-w-80 rounded-panel border border-hairline bg-raised p-1 shadow-raised outline-none">
            {identity ? (
              <Menu.Group>
                <Menu.GroupLabel className="truncate px-3 pb-2 pt-1.5 text-body-sm text-ink-secondary">{identity.email}</Menu.GroupLabel>
                <div role="separator" className="mx-1 mb-1 h-px bg-hairline" />
                {settings}
              </Menu.Group>
            ) : (
              settings
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
