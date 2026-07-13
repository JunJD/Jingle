# JINGLE-MOTION-003: Perpetual motion represents a real running state

## Symptom

A stylesheet loops forever without going through the shared spinner contract, often leaving decorative motion active during an idle state.

## Owner

The business component owns whether work is actually running; the shared primitive owns how that state moves and how reduced motion behaves.

## Cause

A perpetual CSS or JavaScript animation was detached from an explicit running state or reused for decoration.

## Required fix

Delete decorative loops. For real work, bind motion to an explicit running state, use a shared primitive, and provide a reduced-motion rule.

## Recurrence guard

Jingle Doctor parses CSS animation declarations and JavaScript motion options, reporting non-Spinner `infinite`, `iterations: Infinity`, and `repeat: Infinity` loops.
