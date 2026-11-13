.PHONY: setup check check-copy test audit demo build room icons

setup:
	uv sync

check: check-copy
	uv run ruff format --check eastroom tests tools
	uv run ruff check eastroom tests tools
	uv run pyright
	$(MAKE) test

test:
	uv run python -m unittest discover -s tests -t .
	node --test "tests/web/*.test.mjs"

check-copy:
	! git grep -nIiE '@(gmail|icloud)\.'

# Before a release: secrets anywhere in history.
audit: check-copy
	gitleaks detect --log-opts=--all

demo:
	uv run eastroom samples/meditations.epub

build:
	uv build

# The room's pictures and the icons are made from sources by these two; see THIRD-PARTY.md for the scans.
room:
	uv run python tools/make_room.py $(MARBLE) $(WOOD)

icons:
	uv run python tools/make_icons.py
