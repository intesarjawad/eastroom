# 4. No runtime dependencies

Date: 2026-11-13. Status: accepted.

## Context

East Room is meant to be run by someone who has just heard of it, with one command, on whatever Python they have. Every dependency is a way for that first run to fail, and a book reader has no need to reach the network.

## Decision

The package declares no dependencies. An EPUB is a zip of XHTML, so `zipfile`, `html.parser` and `http.server` read and serve it. Tests use `unittest` and Node's own test runner, so the test matrix installs nothing. Three things that cannot be done with the standard library are optional extras in their own process or behind their own import: narration (`voice`, `storyteller`) and PDF reading (`pdf`). The front end has no build step: plain modules, with GSAP, Lenis and Pretext vendored as files.

Development tools are a separate matter. The linter, the type checker and the two libraries that `tools/` needs are pinned in a dev group in `uv.lock`.

## Why

- `uvx --from git+... eastroom book.epub` works on a clean machine in seconds.
- Nothing in the reading path can break because a package released a new version.
- The whole server is short enough to read in a sitting, which matters for a program that opens files people give it.

## Cost

Some code exists that a library would have provided: a small HTML walker, byte-range answers, a multipart-free upload route. PDF text needs the `pdf` extra. `unittest` is plainer to write than pytest.
