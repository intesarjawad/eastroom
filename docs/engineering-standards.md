# Engineering standards

I hold every change in this repository to the rules below. CONTRIBUTING.md links here so contributors work to the same bar.

## 1. Code

1. Clarity over cleverness. Names say what a thing is in the domain (`chapter_count`, not `val2`). Units go in names or types (`timeout_ms`, `pace_wpm`).
2. Small units: a function does one thing; files stay focused (soft cap around 300 lines). No catch-all `utils` module; name modules by responsibility.
3. Pure core, thin I/O shell. Core logic has no network, filesystem, clock or randomness hidden inside; pass them in. This is what makes it testable.
4. Types are strict and honest: no `Any`, no `# type: ignore`, no casts to silence the checker. Model states explicitly instead of with booleans and nullable fields.
5. Errors: validate at trust boundaries (user input, files, network, model output) and fail loudly with an actionable message. Never swallow exceptions. No defensive checks for states the types already rule out.
6. No magic numbers: named constants with units and a one-line source or reason when non-obvious.
7. No global mutable state. No singletons unless the platform forces it.
8. Dependencies: the app has no runtime dependencies ([ADR 0004](adr/0004-no-runtime-dependencies.md)). Optional extras and development tools are few, maintained, pinned and licence-compatible.
9. Performance claims come from a script in the repository, never from prose.

## 2. What stays out

- Comments that narrate the code, banner comments, and docstrings that restate the signature. Comments explain why, constraints or sources. Public functions get concise docstrings.
- Wrapper functions that only forward arguments; abstract base classes with one implementation; factories nobody needs; "manager" or "helper" classes without a real responsibility.
- Try/except around everything, redundant type checks, and re-validation of data that is already validated.
- Dead code, commented-out code, unused imports, parameters or exports, a `TODO` without an issue link, debug printing, leftover feature flags.
- Near-duplicate code blocks, inconsistent naming styles and mixed formatting.
- Emoji in code, logs or command-line output; marketing words in docs; exclamation marks in log messages.
- Logging for its own sake. Log levels mean something.
- Tests that assert nothing meaningful, snapshot everything, or mock the unit under test.
- Large generated files committed without need, and code copied in for later.

## 3. Tests

- Test behaviour, not implementation. Tests are deterministic: seeded randomness and fixed clocks. Fast unit tests cover the pure core, and a few integration tests cover the server and the files it writes.
- Every bug fix lands with the test that would have caught it.
- Coverage is a signal, not a goal: aim for high coverage of the core logic, and do not write tests to hit a number.

## 4. Tooling

- Python: uv with a committed lockfile; ruff for lint and format; pyright in strict mode; the standard library's `unittest`.
- Web: plain modules with no build step, tested with `node --test`.
- `make check` runs format, lint, type check, the copy check and every test. Pre-commit hooks run the fast part, and CI runs `make check` on every pull request; `main` is protected and green.

## 5. Repository hygiene

- LICENSE, README, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, CHANGELOG.md (Keep a Changelog), semantic versioning, `.editorconfig`, issue and pull request templates, automated dependency updates, CodeQL, a committed lockfile, and no secrets.
- `docs/architecture.md` with a diagram; `docs/adr/` with a short decision record for every major choice.
- Reproducibility: one command to set up (`make setup`), one to test (`make check`), one to run the demo (`make demo`).

## 5a. Version pins

- When I add or refresh a pin I confirm it is the latest stable release (`uv pip index versions <pkg>` or the registry page), take the newer stable version if one exists, and note the change in the lockfile commit. A pin never moves backwards without a decision record.

## 6. Git

- Small, atomic commits with conventional-commit messages that explain why. One logical change per pull request, with a description, and screenshots for interface changes.
- History stays clean: no chains of typo fixes on `main` (squash or fix up before merge).

## 7. Accessibility and interaction

- Keyboard reachable, visible focus, semantic structure, labelled controls, colour contrast meeting WCAG 2.2 AA, `prefers-reduced-motion` respected, no information conveyed by colour alone.

## 8. Before a change is done

1. Read the issue and the files it touches.
2. Write or update the test first where practical.
3. Make the smallest complete change.
4. Run `make check`; it must pass.
5. Re-read the diff against sections 1 and 2 and fix anything that fails.
6. Commit with a proper message. A change is never done with failing checks or skipped tests.
