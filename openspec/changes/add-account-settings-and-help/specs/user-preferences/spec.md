# Spec Delta

## Purpose

Defines the Settings page and the per-browser preferences it controls, starting with the appearance theme, so the user can override defaults and have the choice applied consistently on every page.

## ADDED Requirements

### Requirement: Settings page
The application SHALL provide a Settings page at `/settings`, reached from the account menu. It SHALL have the heading "Settings" and an "Appearance" section. It SHALL NOT be a top-bar destination, so no destination is marked current while it is open.

#### Scenario: Settings is opened from the account menu
- **WHEN** the user chooses "Settings" in the account menu
- **THEN** `/settings` opens with the heading "Settings", the browser tab title contains "Settings" and "JD Fit Check", and the Appearance section is shown

#### Scenario: Settings is opened directly
- **WHEN** the user enters `/settings` in the address bar
- **THEN** the same page loads, and none of Fit Check, Experience or Help is marked current

### Requirement: Appearance choice
The Appearance section SHALL offer exactly three mutually exclusive options, "Auto", "Light" and "Dark", as a single labelled group with the current choice selected. Auto SHALL be selected when the user has never chosen. A choice SHALL take effect immediately, with no save button.

#### Scenario: First visit
- **WHEN** a browser that has never saved an appearance opens `/settings`
- **THEN** "Auto" is selected and the page follows the operating-system colour preference

#### Scenario: User picks Dark
- **WHEN** the user selects "Dark" while the operating system prefers light
- **THEN** every token switches to the dark set at once, without a reload or navigation

#### Scenario: User picks Light
- **WHEN** the user selects "Light" while the operating system prefers dark
- **THEN** every token switches to the light set at once

#### Scenario: User returns to Auto
- **WHEN** the user selects "Auto"
- **THEN** the page follows the operating-system colour preference again

#### Scenario: Keyboard use
- **WHEN** a keyboard user tabs into the Appearance group and presses the arrow keys
- **THEN** focus and selection move between the three options and the theme follows the selection

### Requirement: Appearance persistence per browser
The appearance choice SHALL be stored in the browser and apply to every page of the application in that browser, across reloads, restarts and deploys. It SHALL NOT be sent to the server or shared between browsers or devices.

#### Scenario: Reload after choosing
- **WHEN** the user selects "Dark", then reloads or opens any other page
- **THEN** the page renders dark and `/settings` shows "Dark" selected

#### Scenario: Another browser
- **WHEN** the user opens the application in a different browser or device
- **THEN** that browser uses its own saved choice, or Auto if it has none

#### Scenario: Another open tab
- **WHEN** the user changes the appearance while a second tab of the application is open in the same browser
- **THEN** the second tab adopts the new choice without a reload

#### Scenario: Browser storage is unavailable
- **WHEN** the browser refuses access to local storage, for example in a locked-down private window
- **THEN** the application renders with Auto, the Settings page still works for the current page view, and no error is shown

### Requirement: Theme applied before first paint
On every full page load, the saved appearance SHALL be in effect before the browser first paints, so a page never shows the other theme first. On Auto, a change of the operating-system preference while a page is open SHALL switch the theme without a reload.

#### Scenario: Saved Dark on a light system
- **WHEN** the saved choice is "Dark", the operating system prefers light, and the user loads any page
- **THEN** the first painted frame already uses the dark tokens

#### Scenario: Saved Light on a dark system
- **WHEN** the saved choice is "Light", the operating system prefers dark, and the user loads any page
- **THEN** the first painted frame already uses the light tokens

#### Scenario: System changes while on Auto
- **WHEN** the choice is "Auto" and the operating system switches between light and dark while a page is open
- **THEN** the page switches theme without a reload

#### Scenario: System changes while a fixed theme is chosen
- **WHEN** the choice is "Light" or "Dark" and the operating-system preference changes
- **THEN** the page keeps the chosen theme

#### Scenario: Client-side navigation
- **WHEN** the user moves between pages through in-app links
- **THEN** the chosen theme stays in effect on every page with no flash
