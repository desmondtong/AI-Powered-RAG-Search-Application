/**
 * Help page content (add-account-settings-and-help, design Decision 6). One section per user-facing feature, in
 * page order. Help describes only behaviour the application has; add a section here when a feature ships.
 *
 * The Experience section is built from `HOW_IT_WORKS`, so the six stage sentences have one source shared with the
 * Fit Check empty state.
 */
import { FIT_CHECK, HOW_IT_WORKS, NAV, SETTINGS_PAGE } from "./copy";

export type HelpBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "steps"; items: readonly string[] }
  | { kind: "terms"; items: ReadonlyArray<{ term: string; description: string }> };

export interface HelpSection {
  /** Stable anchor: `/help#<id>`. */
  id: string;
  title: string;
  blocks: readonly HelpBlock[];
}

export const HELP_PAGE = {
  title: "Help",
  onThisPage: "On this page",
} as const;

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "fit-check",
    title: NAV.fitCheck,
    blocks: [
      {
        kind: "paragraph",
        text: "Fit Check compares a job description with your indexed experience files and cites every match to your own text.",
      },
      {
        kind: "steps",
        items: [
          "Open Fit Check and paste the job description.",
          "Select Evaluate fit, or press Cmd/Ctrl + Enter.",
          "Read each requirement under its fit group, with the reason and the quoted evidence behind it.",
          "Select a count tile to show only that group; select it again to show every group.",
          "Select Open in source on a citation to see the quoted sentence highlighted in its experience file.",
        ],
      },
      {
        kind: "terms",
        items: [
          { term: "Strong", description: "Your indexed files directly support the requirement." },
          { term: "Partial", description: "Your files support part of the requirement." },
          { term: "Weak", description: "The evidence found is indirect or thin." },
          { term: "Missing", description: "Nothing in your indexed files supports the requirement." },
        ],
      },
      { kind: "paragraph", text: FIT_CHECK.gapsNote },
    ],
  },
  {
    id: "experience",
    title: NAV.experience,
    blocks: [
      {
        kind: "paragraph",
        text: "Each experience file moves through six stages before Fit Check can search it.",
      },
      { kind: "terms", items: HOW_IT_WORKS.map((stage) => ({ term: stage.name, description: stage.description })) },
    ],
  },
  {
    id: "settings",
    title: SETTINGS_PAGE.title,
    blocks: [
      {
        kind: "paragraph",
        text: "Open Settings from the account menu, the round avatar at the right end of the top bar.",
      },
      {
        kind: "terms",
        items: [
          { term: SETTINGS_PAGE.options.auto.label, description: "Follows your device's light or dark setting. This is the default." },
          { term: SETTINGS_PAGE.options.light.label, description: SETTINGS_PAGE.options.light.description },
          { term: SETTINGS_PAGE.options.dark.label, description: SETTINGS_PAGE.options.dark.description },
        ],
      },
      {
        kind: "paragraph",
        text: "Your choice applies at once and is saved in this browser only, so another browser or device starts on Auto.",
      },
    ],
  },
];
