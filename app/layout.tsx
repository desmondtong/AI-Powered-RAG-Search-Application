import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nunito_Sans, Source_Sans_3 } from "next/font/google";
import TopBar from "./components/TopBar";
import { WorkspaceSummaryProvider } from "./components/WorkspaceSummaryProvider";
import "./globals.css";

const headingFont = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
});

const bodyFont = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "JD Fit Check", template: "%s · JD Fit Check" },
  description: "Check how your approved, indexed experience fits a job description, with every claim cited to your own files.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${headingFont.variable} ${bodyFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-ground text-ink font-body">
        <WorkspaceSummaryProvider>
          <TopBar />
          <div className="flex-1">{children}</div>
        </WorkspaceSummaryProvider>
      </body>
    </html>
  );
}
