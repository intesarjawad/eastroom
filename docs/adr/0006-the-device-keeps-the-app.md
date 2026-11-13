# 6. Each device keeps the app and the books it is reading

Date: 2026-11-13. Status: accepted.

## Context

Home is a computer at home that sleeps. A phone on a train must still open the book at the right line, and must not wait for a server that will not answer.

## Decision

A service worker (`web/sw.js`) follows two rules. An address that carries a stamp (`?v=`) never changes its content, so it is answered from the device's copy and fetched once. Everything else is asked from Home first with a limit of 1.5 seconds and answered from the copy when Home is asleep or out of reach. After one failure the copy is used straight away for half a minute.

The app's own files are listed in the worker and stored when it installs. `web/hold.js` asks for the text of every unfinished book and for narration around the reading place. Reading records are not handled by the worker: each device writes its own (see ADR 1) and sends it when Home next answers.

## Why

- A stamped address needs no revalidation, so reading costs no requests once a part is on the device.
- The time limit means a sleeping Home never slows a page by more than a moment.
- No native app, no store, no account: "Add to Home Screen" is the install.

## Cost

Every file the app needs must be named in the worker's list, and a missing one stops the install. `tests/test_voice.py` checks that the list and the app's files are the same set. The list includes ten display typefaces that only some spines use.
