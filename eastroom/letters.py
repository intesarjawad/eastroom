"""A spine lettered like its cover.

A local vision model looks at the cover once and says what kind of lettering the title is set in.
The spine is then set in the nearest face of a small shelf of open typefaces that ship with the
reader. The model only ever picks from fixed lists, so a wrong answer is a
plausible spine and never a broken one.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

FACES = {  # what the model may answer: the face the reader has for it
    "geometric-sans": "League Spartan",
    "humanist-sans": "League Spartan",
    "grotesque-sans": "Science Gothic",
    "condensed-sans": "Science Gothic",
    "poster-heavy": "Science Gothic",
    "oldstyle-serif": "EB Garamond",
    "transitional-serif": "Literata",
    "didone-serif": "Playfair Display",
    "slab-serif": "Zilla Slab",
    "inscriptional-caps": "Cinzel",
    "blackletter": "UnifrakturCook",
    "script": "Pinyon Script",
    "handwritten": "Caveat",
    "typewriter": "Special Elite",
    "art-deco": "Poiret One",
}
CHOICES = {
    "weight": ["light", "regular", "bold", "black"],
    "case": ["upper", "title", "lower"],
    "width": ["condensed", "normal", "wide"],
    "spacing": ["tight", "normal", "wide"],
}
SCHEMA = {
    "type": "object",
    "required": ["kind", *CHOICES],
    "properties": {
        "kind": {"type": "string", "enum": [*FACES, "no-lettering"]},
        **{k: {"type": "string", "enum": v} for k, v in CHOICES.items()},
    },
}
PROMPT = (
    "This is the front cover of a book. Look only at the lettering of the book's TITLE (the "
    "largest words that name the book), not the author's name or small print.\n"
    "Describe that lettering:\n"
    "- kind: the style of typeface. geometric-sans (round, even strokes, like Futura), "
    "humanist-sans, grotesque-sans (like Helvetica), condensed-sans (tall and narrow),\n"
    "  poster-heavy (very thick block letters), oldstyle-serif (like Garamond), "
    "transitional-serif (like Baskerville or Times), didone-serif (strong thick and thin, "
    "like Bodoni),\n"
    "  slab-serif (thick square serifs), inscriptional-caps (carved Roman capitals, like "
    "Trajan), blackletter (gothic), script (formal joined writing), handwritten,\n"
    "  typewriter, art-deco (1920s display). Answer no-lettering if the cover shows no title.\n"
    "- weight: how thick the strokes are.\n"
    "- case: upper if the title is all capitals, lower if it has none, otherwise title.\n"
    "- width: how wide the letters are.\n"
    "- spacing: how far apart the letters stand."
)


def match(
    book: Path,
    ask: Callable[[str, tuple[bytes, ...], dict[str, Any]], dict[str, Any]],
    by: str,
    media: Path | None = None,
) -> dict[str, Any]:
    """Asks a model about the book's cover and writes the answer into the
    book's index as `spine`. Returns it.

    `ask(prompt, images, schema)` is the owner's engine for looking at pictures and `by` its name.
    `media` is where an adopted book keeps its pictures, when that is not the book's own folder.
    """
    index = json.loads((book / "book.json").read_text(encoding="utf-8"))
    cover = next(
        (
            p
            for p in (book / (index.get("cover") or "cover.jpg"), (media or book) / "cover.jpg")
            if p.is_file()
        ),
        None,
    )
    if cover is None:
        raise ValueError("This book has no cover to look at.")
    said = ask(PROMPT, (cover.read_bytes(),), SCHEMA)
    kind = said.get("kind")
    if kind not in FACES:
        raise ValueError(
            "The model found no title lettering on this cover. The spine keeps its plain style."
        )
    spine = {
        "face": FACES[kind],
        "kind": kind,
        **{k: said[k] if said.get(k) in v else v[1] for k, v in CHOICES.items()},
        "by": by,
    }
    index = json.loads(
        (book / "book.json").read_text(encoding="utf-8")
    )  # read again: the look took a while and the index may have changed
    index["spine"] = spine
    tmp = book / "book.tmp"
    tmp.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(book / "book.json")
    return spine
