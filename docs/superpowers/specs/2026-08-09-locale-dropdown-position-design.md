# Locale Dropdown Position Design

## Goal

Keep the header locale menu anchored below its trigger after any sequence of Korean and English locale changes, without changing the positioning behavior of other selects.

## Root Cause

Rocky's shared `SelectContent` enables Base UI's `alignItemWithTrigger` behavior by default. That mode intentionally overlaps the popup with the trigger so the selected item's text aligns with the trigger value. When the locale changes, the selected item and translated label change, and Base UI recalculates that item-aligned popup position. Because the locale switcher sits in the top header, the recalculated popup can move into the header area.

## Design

The locale switcher will opt out of item-aligned positioning by passing `alignItemWithTrigger={false}` to its `SelectContent`. It will also use `sideOffset={8}` because the 36-pixel trigger is vertically centered in the 48-pixel header and Base UI's default 4-pixel offset leaves the popup two pixels inside the header. Base UI will then use its regular bottom-anchored positioning with `align="end"`. This keeps the menu below and right-aligned with the trigger while retaining Base UI's viewport collision handling.

The shared `SelectContent` default remains unchanged because other selects may depend on item-aligned behavior. The locale provider and translated labels also remain unchanged; remounting the select on locale changes would only mask the positioning mode rather than remove the cause.

## Data Flow

1. The user opens the locale select from the site header.
2. Selecting a locale updates `I18nProvider` state and closes the popup.
3. React renders the new locale label in the same fixed-width trigger.
4. On reopening, Base UI positions the popup below the trigger instead of aligning the selected item over it.

## Error and Boundary Handling

No new error state is required. Base UI's standard positioned-popup path continues to constrain the menu to the available viewport. The change is local to the header locale switcher and does not alter locale persistence or unsupported-locale normalization.

## Verification

Add a Playwright regression test that:

- starts in Korean with product tours disabled;
- switches Korean to English, then English to Korean, reopening the menu after each change;
- repeats the reverse direction;
- compares trigger, popup, header, and viewport bounding boxes;
- requires the popup top to be below the trigger bottom and header bottom, with every popup edge inside the viewport.

Run the focused Playwright test, the web production build, and the repository test suite.

## Out of Scope

- Changing the shared select positioning default.
- Changing locale labels, trigger width, or header layout.
- Refactoring the locale provider or static DOM translation system.
