# JINGLE-UI-001: UI primitives remain product-agnostic

## Symptom

A module under `components/ui` knows about Jingle IPC, a feature, a shell, or hard-coded business copy.

## Owner

`components/ui` owns reusable interaction mechanics, accessibility, geometry, variants, and motion. Feature controllers and business components own product data and copy.

## Cause

A primitive absorbed feature data, transport behavior, or product wording instead of exposing a typed mechanical prop.

## Required fix

Inject labels and behavior through typed props. Move business projection and IPC to the feature controller. Keep only primitive-local imports in `components/ui`.

## Recurrence guard

Jingle Doctor checks primitive imports, preload bridge access, JSX text, and user-facing intrinsic attributes across the complete primitive directory.
