# 1. One reading record per device

Date: 2026-11-12. Status: accepted.

## Context

Version 0.1 kept one `state.json` per book, written by whichever page saved last. With a phone and a tablet reading the same book, the slower one would overwrite the other's place and kept lines.

## Decision

Each device writes only its own file, `state/<device>.json`, and sends it whole. Home stores records and never merges them. The app combines every device's record when it shows a book: the newest place wins and the furthest place is offered, kept lines are the union minus removals (a removed line stays as a marker with a time), finished parts take the newest answer, and reading time is summed per device per day. Home sets stamps from the future back to its own clock, and each device stamps with Home's clock as it last heard it, so a wrong clock cannot win for ever. Every record carries a change counter, and Home ignores a save with a lower counter than the one it holds, so two saves from one device that cross on the way cannot undo each other.

## Why

- No two writers ever touch the same file, so there is nothing to lock and nothing to lose.
- The combining rules are a pure function with tests (`tests/web/records.test.mjs`), and the result does not depend on the order records arrive in.
- A record is a few kilobytes. Sending it whole is simpler than a change log and survives a missed sync.

## Considered

- A change journal replayed at Home: more code, and it needs compaction.
- A CRDT library: none of the reading apps I studied use one for this, and the data here does not need it.
- Last write wins on one file: the bug this replaces.

## Cost

A device that is never used again leaves its record behind. The old `state.json` is read as a device named "before" and is never written again.
