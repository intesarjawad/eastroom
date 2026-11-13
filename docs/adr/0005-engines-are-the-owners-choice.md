# 5. Engines are the owner's choice, and no model is named in code

Date: 2026-11-13. Status: accepted.

## Context

Two workshop jobs can use a model: matching a spine's lettering to its cover, and choosing key lines among sentences already ranked without one. Models change every few months, and a reader's books are private. A model name written into the code would be stale within the year, and a hosted default would send book text somewhere the owner did not pick.

## Decision

`engines.py` asks one question of an engine the owner selected in Settings. There are two kinds: a terminal tool the owner is already signed in to on that computer, and any server that speaks the OpenAI chat API, local or remote. The code holds no model name and no default engine. Neither job is needed: without an engine, key lines come from the ranking alone and spines are lettered by rule.

A key for a server is stored in a file only the owner can read, and is never sent back to the page.

## Why

- The reading path never depends on a model, so it never costs money or needs a connection.
- A model that runs on the owner's computer keeps the text on it.
- Nothing needs releasing when a model is replaced.

## Cost

The first use of either job means a visit to Settings. Answers differ between engines, so both jobs check what comes back: a key line must be one of the ranked sentences, word for word, and a lettering answer must name a face the app has.
