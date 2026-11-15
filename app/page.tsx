import type { Metadata } from "next";
import JdFitPanel from "./components/JdFitPanel";
import { FIT_CHECK } from "./lib/experience/workspace/copy";

// The root layout's title template does not apply to a page in the same segment, so the full title is given here.
export const metadata: Metadata = { title: { absolute: "Fit Check · JD Fit Check" } };

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-[960px] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-heading text-headline-xl text-ink">{FIT_CHECK.title}</h1>
      </header>
      <JdFitPanel />
    </main>
  );
}
