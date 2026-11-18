import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Nunito_Sans, Source_Sans_3 } from "next/font/google";
import { APPEARANCE_HEAD_SCRIPT } from "./lib/experience/workspace/appearance";
import { AvatarPlaceholder } from "./components/AccountMenu";
import AccountSlot from "./components/AccountSlot";
import { InlineScript } from "./components/InlineScript";
import { LeaveGuardProvider } from "./components/LeaveGuardProvider";
import { NoticeProvider } from "./components/NoticeProvider";
import TopBar from "./components/TopBar";
import { AppearanceSync } from "./components/useAppearance";
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
    // The head script sets data-theme on <html> before React hydrates, so React must accept that attribute.
    <html lang="en" className={`${headingFont.variable} ${bodyFont.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <InlineScript html={APPEARANCE_HEAD_SCRIPT} />
      </head>
      <body className="min-h-full flex flex-col bg-ground text-ink font-body">
        <AppearanceSync />
        <LeaveGuardProvider>
          <NoticeProvider>
            <WorkspaceSummaryProvider>
              <TopBar
                account={
                  <Suspense fallback={<AvatarPlaceholder />}>
                    <AccountSlot />
                  </Suspense>
                }
              />
              <div className="flex-1">{children}</div>
            </WorkspaceSummaryProvider>
          </NoticeProvider>
        </LeaveGuardProvider>
      </body>
    </html>
  );
}
