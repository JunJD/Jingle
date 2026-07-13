# JINGLE-BOUNDARY-002: Lower renderer layers do not import shells

## Symptom

A reusable component or feature imports a page or shell module, reversing the intended dependency direction.

## Owner

Pages and shells compose features. Features and business components may depend on UI primitives, shared types, and feature-local controllers, but never on a shell.

## Cause

A reusable type, projection, copy object, or control was placed under a shell and then imported downward.

## Required fix

Move reusable copy, view models, and controls to their real feature or shared owner. Delete the lower-to-upper import instead of adding a re-export or compatibility module.

## Recurrence guard

Jingle Doctor classifies every top-level renderer directory and root file, resolves static and dynamic imports from lower roots, and rejects dependencies on page and shell owners. A new root or unresolved alias is a finding until its ownership is explicit.
