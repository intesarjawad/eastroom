# 8. Strict types, a pinned toolchain and one check command

Date: 2026-11-13. Status: accepted.

## Context

The code talks to files and requests whose shapes are JSON. Without types, a wrong key shows up as a broken page on someone's phone.

## Decision

`make check` is the one gate, run locally and in CI: `ruff format --check`, `ruff check`, `pyright` in strict mode, the Python tests, the page-rule tests under Node, and a check that no personal mail address is tracked. The linter and type checker are pinned in `uv.lock`. Actions in the workflows are pinned to commits.

JSON is typed as `dict[str, Any]` where it enters, and as real types inside the functions that use it. The package is tested bare, with no dev tools installed, on the oldest and the newest Python it supports and on three systems.

## Why

- One command means a contributor and the CI can never disagree about what "passing" is.
- Strict mode finds the missing `None` check before a reader does.

## Cost

The front end has no type checker and no browser test yet; it is checked by hand in a browser, which the pull request template asks for. Several source files are longer than the standards ask and are due to be split.
