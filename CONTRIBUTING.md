# Contributing

Thanks for looking. Small, focused changes are the easiest to review and merge.

## Set up

```sh
git clone https://github.com/intesarjawad/eastroom && cd eastroom
make setup    # the pinned linter and type checker, through uv
make check    # format, lint, types, tests, prose rules
make demo     # the library with one public-domain book
```

The package has no dependencies and the front end has no build step. The tests need nothing but Python and Node: `python -m unittest discover -s tests -t .` and `node --test "tests/web/*.test.mjs"`.

## What a change needs

1. A test that fails without it, when it changes the importer or the server. Tests build their own small EPUB (`tests/epub_fixture.py`); do not commit book files.
2. `make check` passing.
3. For anything visible, a screenshot or a short recording in the pull request, at a desktop width and a phone width.
4. One logical change per pull request, with a message that says why.

## Ground rules for the product

- The author's text is never altered, summarised or added to.
- No network requests, accounts or telemetry.
- No new runtime dependency without a strong reason. The standard library and the browser cover a lot.
- Every control works from the keyboard, and motion respects `prefers-reduced-motion`.

The full bar for code is in [docs/engineering-standards.md](docs/engineering-standards.md).

## Reporting a book that imports badly

Open an issue with the "Book imports badly" template. Say where the book came from and what went wrong (chapters merged, titles missing, text lost). Please do not attach copyrighted books; a public-domain example that shows the same problem is ideal.
