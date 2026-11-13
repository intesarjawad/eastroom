"""Key lines of a part, always in the author's exact words.

Without a model, sentences are ranked by how much of the part's vocabulary they share with the other
sentences (the method known as TextRank). With a local model, the model is shown the ranked
candidates by number and answers with numbers only, so what it picks is still a sentence of the book
and never a sentence of its own.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

from . import voice
from .files import patient

VERSION = 1
MAX_RANKED = 400  # sentences of one part that are ranked against each other
# fmt: off
STOP = frozenset([
    "a", "about", "above", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as",
    "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
    "can", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from",
    "further", "had", "has", "have", "having", "he", "her", "here", "hers", "him", "his", "how",
    "i", "if", "in", "into", "is", "it", "its", "just", "me", "more", "most", "my", "no", "nor",
    "not", "now", "of", "off", "on", "once", "only", "or", "other", "our", "out", "over", "own",
    "same", "she", "should", "so", "some", "such", "than", "that", "the", "their", "them", "then",
    "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up",
    "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why",
    "will", "with", "would", "you", "your", "one", "said", "upon", "shall", "may", "must", "might",
    "much", "many", "every",
])
# fmt: on
WORD = re.compile(r"[a-z][a-z'’-]+")
MIN_WORDS, MAX_WORDS, CANDIDATES = 8, 42, 18
Choose = Callable[[list[str], int], list[Any]]


def how_many(words: int) -> int:
    return max(3, min(5, words // 1500))


def candidates(blocks: list[dict[str, Any]]) -> list[tuple[float, str, str]]:
    """(score, block id, sentence), best first. Only whole sentences of paragraphs, of a
    length that can be held in mind."""
    found: list[tuple[str, str, Counter[str]]] = []
    for block in blocks:
        if block["k"] != "p":
            continue
        text = " ".join(block["t"].split())
        for sentence in voice.sentences(text):
            sentence = sentence.strip()
            terms = Counter(w for w in WORD.findall(sentence.lower()) if w not in STOP)
            if (
                MIN_WORDS <= len(sentence.split()) <= MAX_WORDS
                and len(terms) >= 3
                and sentence in text
                and not sentence.endswith("?")
            ):
                found.append((block["id"], sentence, terms))
    if len(found) < 2:
        return [(1.0, b, s) for b, s, _ in found]
    if (
        len(found) > MAX_RANKED
    ):  # ranking compares every sentence with every other: an even sample keeps that bounded
        found = [found[i * len(found) // MAX_RANKED] for i in range(MAX_RANKED)]
    seen = Counter(term for _, _, terms in found for term in terms)
    weight = {term: math.log(1 + len(found) / n) for term, n in seen.items()}
    vectors = [{t: n * weight[t] for t, n in terms.items()} for _, _, terms in found]
    norms = [math.sqrt(sum(v * v for v in vec.values())) or 1.0 for vec in vectors]
    links = [[0.0] * len(found) for _ in found]
    for i, a in enumerate(vectors):
        for j in range(i + 1, len(vectors)):
            b = vectors[j]
            small, large = (a, b) if len(a) < len(b) else (b, a)
            links[i][j] = links[j][i] = sum(v * large.get(t, 0.0) for t, v in small.items()) / (
                norms[i] * norms[j]
            )
    totals = [sum(row) or 1.0 for row in links]
    rank = [1.0] * len(found)
    for _ in range(24):
        rank = [
            0.15 + 0.85 * sum(links[j][i] / totals[j] * rank[j] for j in range(len(found)))
            for i in range(len(found))
        ]
    return sorted(
        ((rank[i], found[i][0], found[i][1]) for i in range(len(found))), key=lambda x: -x[0]
    )


def spread(ranked: list[tuple[float, str, str]], n: int) -> list[tuple[str, str]]:
    """The best `n`, never two from one paragraph, returned in the order the author wrote them."""
    picked: list[tuple[str, str]] = []
    used: set[str] = set()
    for _, block, sentence in ranked:
        if block not in used:
            picked.append((block, sentence))
            used.add(block)
        if len(picked) == n:
            break
    return sorted(picked)


def for_chapter(chapter: dict[str, Any], choose: Choose | None = None) -> list[dict[str, Any]]:
    """`choose(sentences, n)` is the model's pick as positions in the list it was shown; any answer
    that is not such a list is ignored."""
    words = sum(len(b["t"].split()) for b in chapter["blocks"])
    ranked, n, by = candidates(chapter["blocks"]), how_many(words), "rank"
    if choose and len(ranked) > n:
        shown = ranked[:CANDIDATES]
        try:
            picks = [
                i
                for i in dict.fromkeys(choose([s for _, _, s in shown], n))
                if isinstance(i, int) and 0 <= i < len(shown)
            ]
        except (OSError, ValueError, KeyError, TypeError):
            picks = []
        if len(picks) >= min(n, 2):
            ranked, by = [shown[i] for i in picks], "model"
    return [{"block": block, "quote": sentence, "by": by} for block, sentence in spread(ranked, n)]


def make(
    book: Path,
    choose: Choose | None = None,
    step: Callable[[int, int], None] | None = None,
    stop: Callable[[], object] | None = None,
) -> int:
    """Writes key lines into every part that has none of this kind yet. Lines that came
    with the book are never replaced."""
    paths = sorted((book / "chapters").glob("c*.json"))
    made = 0
    for done, path in enumerate(paths, 1):
        if stop and stop():
            break
        chapter = json.loads(path.read_text(encoding="utf-8"))
        old: list[Any] = chapter.get("takeaways") or []
        want = "model" if choose else "rank"
        if old and (not all("by" in t for t in old) or all(t["by"] == want for t in old)):
            if step:
                step(done, len(paths))
            continue  # the book's own, or already made this way
        chapter["takeaways"] = for_chapter(chapter, choose)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(chapter, ensure_ascii=False), encoding="utf-8")
        patient(tmp.replace, path)
        made += 1
        if step:
            step(done, len(paths))
    return made
