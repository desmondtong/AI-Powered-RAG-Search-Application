# Spec Delta

## Purpose

Defines the Help page as the single home for how-to content about JD Fit Check, organised by feature, so that instructions for current and future features live in one place instead of being scattered across working screens.

## ADDED Requirements

### Requirement: Help page
The application SHALL provide a Help page at `/help`, reachable from the "Help" top-bar destination. It SHALL have the heading "Help" and one section per user-facing feature, in this order: "Fit Check", "Experience" and "Settings". Each section SHALL have a heading and a stable anchor (`#fit-check`, `#experience`, `#settings`).

#### Scenario: Help is opened
- **WHEN** the user activates the "Help" top-bar destination
- **THEN** `/help` opens with the heading "Help", the browser tab title contains "Help" and "JD Fit Check", and the three sections appear in order

#### Scenario: A section is linked directly
- **WHEN** the user opens `/help#experience`
- **THEN** the page scrolls to the Experience section, and its heading is visible below the sticky top bar rather than hidden under it

### Requirement: Help table of contents
The Help page SHALL show an "On this page" list that links to every section in the page's order. On wide screens it SHALL stay visible while the sections scroll. On phone widths it SHALL appear once above the first section.

#### Scenario: Wide screen
- **WHEN** the Help page is viewed at 1024 px or wider and the user scrolls through the sections
- **THEN** the "On this page" list stays visible beside the content

#### Scenario: Phone width
- **WHEN** the Help page is viewed at 375 px
- **THEN** the "On this page" list appears above the first section, and nothing scrolls horizontally

#### Scenario: Jump to a section
- **WHEN** the user activates an entry in the "On this page" list
- **THEN** the page moves to that section and the URL hash changes to its anchor

### Requirement: Help section content
- **Fit Check section:** SHALL explain how to paste a job description, evaluate it, read the four fit groups, filter the report and open a citation in its source file.
- **Experience section:** SHALL list the six pipeline stages in order with one sentence each.
- **Settings section:** SHALL explain the Auto, Light and Dark appearance options and where to find them.

Help text SHALL describe only behaviour the application has.

#### Scenario: Experience section
- **WHEN** the user reads the Experience section
- **THEN** it lists Upload, Extract, Parse, Review, Approve and Index in that order with exactly one sentence each

#### Scenario: Settings section
- **WHEN** the user reads the Settings section
- **THEN** it names the three appearance options, states that Auto follows the operating system and that the choice is saved in this browser, and says Settings is opened from the account menu

#### Scenario: Fit Check section
- **WHEN** the user reads the Fit Check section
- **THEN** it covers entering a job description, the four fit groups (Strong, Partial, Weak, Missing), filtering by count tile and opening a citation

### Requirement: Help is a plain reading page
The Help page SHALL make no API request and SHALL render fully without experience data. It SHALL use the same Porcelain & Cobalt tokens and themes as every other screen.

#### Scenario: Help with the API unavailable
- **WHEN** the experience API is unreachable and the user opens `/help`
- **THEN** the full Help content renders, and only the top-bar pill reflects the unavailable count

#### Scenario: Help in either theme
- **WHEN** the Help page is viewed in the light and in the dark theme
- **THEN** headings, body text, links and the "On this page" list are legible in both
