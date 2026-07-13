# JINGLE-UI-003: Product surfaces use shared controls

## Symptom

A product surface renders a raw `button`, `input`, `textarea`, or `select`, bypassing shared focus, disabled, loading, sizing, and press behavior.

## Owner

`components/ui` owns native-control wrappers. Business components choose variants and provide typed values, labels, and commands.

## Cause

A local control was faster to add than extending or adopting the shared primitive, duplicating interaction contracts.

## Required fix

Use `Button`, `IconButton`, `Input`, `Textarea`, `Select`, or `Switch`. Extend the primitive only when a real reusable capability is missing.

## Recurrence guard

Jingle Doctor parses all JSX and reports native controls outside `components/ui`; generated and untracked renderer files are included.
