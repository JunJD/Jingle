# JINGLE-MOTION-002: Loading motion uses Spinner

## Symptom

A surface embeds `animate-spin`, `animate-pulse`, or `animate-ping`, creating inconsistent loading geometry and reduced-motion behavior.

## Owner

`components/ui/Spinner` owns spinner motion and accessible status labeling. Stable skeleton behavior belongs in a dedicated shared primitive before reuse.

## Cause

Loading feedback was implemented locally with animation utilities instead of a shared typed running-state contract.

## Required fix

Use `Spinner` and the `loading` contract on shared buttons. Remove decorative pulse or ping motion unless it represents a typed running state with a shared owner.

## Recurrence guard

Jingle Doctor finds loading animation utilities everywhere outside the Spinner primitive.
