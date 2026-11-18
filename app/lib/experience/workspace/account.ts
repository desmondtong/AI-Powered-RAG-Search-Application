/**
 * The signed-in identity shown in the account menu (add-account-settings-and-help, design Decision 1).
 *
 * Identity-Aware Proxy forwards `x-goog-authenticated-user-email: accounts.google.com:<email>`. It is read for display
 * only: nothing on the page or in the API depends on it, so an absent or malformed value just shows the neutral
 * avatar. If identity is ever used to decide anything, read the verified `email` claim of `x-goog-iap-jwt-assertion`
 * instead.
 */

export const IAP_EMAIL_HEADER = "x-goog-authenticated-user-email";

const IAP_NAMESPACE = "accounts.google.com:";

export interface AccountIdentity {
  email: string;
  /** The avatar letter: the email's first letter or digit, uppercased. Null when it has none. */
  initial: string | null;
}

export function parseIapIdentity(headerValue: string | null | undefined): AccountIdentity | null {
  if (!headerValue) return null;
  let email = headerValue.trim();
  if (email.startsWith(IAP_NAMESPACE)) email = email.slice(IAP_NAMESPACE.length).trim();
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1] || /\s/.test(email)) return null;
  const letter = email.match(/[\p{L}\p{N}]/u)?.[0];
  return { email, initial: letter ? letter.toUpperCase() : null };
}
