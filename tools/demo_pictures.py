"""Gives the demo's books their pictures without asking a model.

    python tools/demo_pictures.py LIBRARY

The pictures step of the workshop asks the owner's AI tool to name a picture for each part. The
demo is built on a machine that has no such tool, so what the step settled on when I ran it
is kept in tools/demo-pictures.json, by book and part number, and handed to the same step
here. The search on Wikimedia Commons, the licence check and the colours are the real ones.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parents[1]))

from eastroom import pictures, work


def main(library: Path) -> int:
    kept: dict[str, dict[str, list[str]]] = json.loads(
        Path(__file__).with_name("demo-pictures.json").read_text(encoding="utf-8")
    )
    for slug, names in kept.items():
        book = library / slug
        said: dict[str, Any] = {
            "parts": [{"n": int(n), "look_for": look_for} for n, look_for in names.items()]
        }
        found, looked = pictures.make(book, book, lambda prompt, schema, said=said: said)
        work.note(book, "pictures", state="done", found=found, of=looked, by="a kept list")
        print(f"{slug}: {found} of {looked} parts have a picture")
        if found < len(names) // 2:
            return 1  # Commons no longer holds what the list names: the list needs another look
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
