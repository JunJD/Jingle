# JINGLE-BOUNDARY-001: Feature controllers own renderer IPC

## Symptom

A page, shell, or presentational component calls `window.api` or `window.electron` directly, so rendering and transport ownership cannot be tested or changed independently.

## Owner

The feature controller owns IPC reads, subscriptions, mutations, typed projections, and commands. Business components consume only typed view models and callbacks.

## Cause

Transport lifecycle and view state were implemented in the same module without a typed controller boundary.

## Required fix

Move the call and its lifecycle into a non-JSX feature module whose filename ends in `Controller` / `-controller` or `-commands`. Pass a typed projection and commands into the component. Do not add an IPC wrapper inside the leaf component.

## Recurrence guard

Jingle Doctor parses every renderer source file, follows simple `window` aliases, and reports preload bridge access outside controller or commands modules.
