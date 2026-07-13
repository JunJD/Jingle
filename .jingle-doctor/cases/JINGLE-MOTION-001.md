# JINGLE-MOTION-001: Transitions name their properties

## Symptom

`transition-all` or `transition: all` animates unrelated layout and paint properties when component state changes.

## Owner

The primitive or surface that owns the state change must name the exact compositor-friendly or color properties it animates.

## Cause

An unbounded utility or CSS shorthand was used before the component's actual animated properties were defined.

## Required fix

Replace the unbounded transition with explicit properties and the shared duration/easing tokens. Prefer `transform` and `opacity` for movement.

## Recurrence guard

Jingle Doctor scans renderer source strings and stylesheets for both Tailwind and CSS forms.
