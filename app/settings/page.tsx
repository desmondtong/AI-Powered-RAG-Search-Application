import type { Metadata } from "next";
import { SETTINGS_PAGE } from "@/app/lib/experience/workspace/copy";
import AppearanceSetting from "./AppearanceSetting";

export const metadata: Metadata = { title: SETTINGS_PAGE.title };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[960px] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-heading text-headline-xl text-ink">{SETTINGS_PAGE.title}</h1>
      </header>
      <AppearanceSetting />
    </main>
  );
}
