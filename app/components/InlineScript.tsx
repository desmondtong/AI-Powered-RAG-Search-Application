"use client";

/**
 * A script that runs synchronously while the HTML is parsed, before first paint (Next guide "Preventing flash before
 * hydration"). It is emitted as JavaScript in the server HTML only; on the client React renders it as inert
 * `text/plain`, so it never re-executes and React does not warn about rendering a script.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
