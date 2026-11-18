import { headers } from "next/headers";
import { IAP_EMAIL_HEADER, parseIapIdentity } from "@/app/lib/experience/workspace/account";
import AccountMenu from "./AccountMenu";

/**
 * Reads the IAP identity for the account menu. It is the only request-time read in the shell, so the root layout
 * renders it inside `<Suspense>` and every route keeps a static shell (`cacheComponents`).
 */
export default async function AccountSlot() {
  const identity = parseIapIdentity((await headers()).get(IAP_EMAIL_HEADER));
  return <AccountMenu identity={identity} />;
}
