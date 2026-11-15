import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Experience" };

export default function ExperienceLayout({ children }: { children: ReactNode }) {
  return children;
}
