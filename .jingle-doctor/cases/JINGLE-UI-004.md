# JINGLE-UI-004: Visible hover help uses Tooltip

## Symptom

An intrinsic visual element uses the browser-native `title` tooltip, producing inconsistent delay, styling, placement, and keyboard behavior.

## Owner

The shared `Tooltip` and `IconButton` primitives own visible hover and focus help. Accessible names such as iframe titles remain native semantics.

## Cause

The browser-native `title` attribute was used as a shortcut for product help or truncated-content disclosure.

## Required fix

Wrap the visual trigger with `Tooltip` or use `IconButton` with a label. Keep accessible naming separate from visible help.

## Recurrence guard

Jingle Doctor checks visual intrinsic JSX elements for `title` while excluding elements where `title` is an accessibility contract.
