# JINGLE-UI-002: Radix imports are wrapped by UI primitives

## Symptom

A product surface imports `@radix-ui/react-*` directly and creates a second menu, dialog, popover, or tooltip contract.

## Owner

The corresponding module under `components/ui` owns Radix integration, accessibility defaults, layering, and microinteraction behavior.

## Cause

A product surface imported Radix directly because the shared primitive did not yet expose the required capability.

## Required fix

Add the missing capability to the shared primitive and migrate the product surface to it. Remove the direct Radix import in the same slice.

## Recurrence guard

Jingle Doctor scans every renderer import and permits Radix only inside `components/ui`.
