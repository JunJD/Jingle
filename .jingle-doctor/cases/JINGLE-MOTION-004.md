# JINGLE-MOTION-004: Shared microinteraction contracts stay complete

## Symptom

The shared press, overlay, floating-surface, spinner, keyboard-modality, or reduced-motion contract is removed or partially renamed.

## Owner

`components/ui`, the renderer motion tokens, and the input-modality bootstrap jointly own the shared microinteraction foundation.

## Cause

Shared motion classes, tokens, and reduced-motion behavior drifted independently without a single structural contract.

## Required fix

Restore the named shared class and token contract. Keyboard navigation must be immediate, pointer press feedback subtle, overlays origin-aware, and reduced motion explicit.

## Recurrence guard

Jingle Doctor validates the required primitive classes, CSS tokens, modality selectors, transform origins, and reduced-motion block as one contract.
