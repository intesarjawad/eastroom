import io
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

from eastroom import formats, ingest
from tests.epub_fixture import png

try:
    import pypdfium2  # noqa: F401
    from PIL import Image  # noqa: F401

    HAS_PDF = True
except ImportError:
    HAS_PDF = False

SENTENCE = (
    "The sea was calm that morning and nobody on deck expected the weather to turn"
    " before the watch was over. "
)


def make_pdf(
    pages: list[list[tuple[float, float, float, str]]], outline: list[tuple[str, int]] = ()
) -> bytes:
    """A PDF with text set where the test says: each page is a list of
    (x, y from the top, size, text)."""
    objects: list[bytes] = []
    add = lambda body: (objects.append(body), len(objects))[1]  # noqa: E731
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    kids = []
    pages_id = len(pages) * 2 + 2
    for lines in pages:
        text = b"".join(
            f"BT /F1 {size} Tf {x} {792 - y} Td ({t}) Tj ET\n".encode() for x, y, size, t in lines
        )
        content = add(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text))
        kids.append(
            add(
                (
                    f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 612 792]"
                    f" /Contents {content} 0 R /Resources << /Font << /F1 {font} 0 R >> >> >>"
                ).encode()
            )
        )
    assert (
        add(
            (
                f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}]"
                f" /Count {len(kids)} >>"
            ).encode()
        )
        == pages_id
    )
    root = f"<< /Type /Catalog /Pages {pages_id} 0 R"
    if outline:
        first = len(objects) + 2
        for n, (title, at) in enumerate(outline):
            links = (f" /Prev {first + n - 1} 0 R" if n else "") + (
                f" /Next {first + n + 1} 0 R" if n + 1 < len(outline) else ""
            )
            objects.append(
                (
                    f"<< /Title ({title}) /Parent {first - 1} 0 R"
                    f" /Dest [{kids[at]} 0 R /Fit]{links} >>"
                ).encode()
            )
        objects.insert(
            first - 2,
            (
                f"<< /Type /Outlines /First {first} 0 R"
                f" /Last {first + len(outline) - 1} 0 R /Count {len(outline)} >>"
            ).encode(),
        )
        root += f" /Outlines {first - 1} 0 R"
    catalog = add((root + " >>").encode())
    out, offsets = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for n, body in enumerate(objects, 1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n%s\nendobj\n" % (n, body))
    start = out.tell()
    out.write(
        b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
        + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    )
    out.write(
        b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, catalog, start)
    )
    return out.getvalue()


def prose_page(
    number: int, head: str, first: str = "", start: int = 0
) -> list[tuple[float, float, float, str]]:
    """A page as a printed book has it: a running head, lines of text, a page number."""
    words = (SENTENCE * 30).split()[start:]
    lines = [(72, 40, 9, head)]
    y = 90
    if first:
        lines.append((72, y, 20, first))
        y += 40
    for n in range(30):
        lines.append(
            (72 + (18 if n % 10 == 0 else 0), y, 11, " ".join(words[n * 11 : n * 11 + 11]))
        )
        y += 15
    return [*lines, (300, 760, 9, str(number))]


class Text(unittest.TestCase):
    def test_a_text_file_becomes_chapters_at_its_headings(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "voyage.md"
            path.write_text(
                "# The Voyage\n\n"
                + "".join(
                    f"## Part {n}\n\n{SENTENCE * 3}\nand the line was\nwrapped by hand.\n\n"
                    for n in range(3)
                ),
                encoding="utf-8",
            )
            book = formats.read_text(path)
        self.assertEqual(
            (book["title"], [c["title"] for c in book["chapters"]]),
            ("The Voyage", ["Part 0", "Part 1", "Part 2"]),
        )
        self.assertTrue(
            book["chapters"][0]["blocks"][0]["t"].endswith("and the line was wrapped by hand.")
        )


class Comics(unittest.TestCase):
    def read(self, entries: dict[str, bytes]) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "Night Ship 03.cbz"
            with zipfile.ZipFile(path, "w") as z:
                for name, data in entries.items():
                    z.writestr(name, data)
            return formats.read_cbz(path)

    def test_pages_come_in_the_order_a_reader_expects_and_junk_is_left_out(self):
        book = self.read(
            {
                "p10.png": png(800, 1200, b"10"),
                "p2.png": png(801, 1200, b"2"),
                "P1.png": png(802, 1200, b"1"),
                "__MACOSX/._p1.png": png(1, 1),
                ".DS_Store": b"x",
                "notes.txt": b"not a page",
                "Thumbs.db": b"x",
            }
        )
        blocks = book["chapters"][0]["blocks"]
        self.assertEqual([b["w"] for b in blocks], [802, 801, 800])
        self.assertEqual(
            (book["kind"], book["title"], book["chapters"][0]["words"]),
            ("pages", "Night Ship 03", 3 * formats.PAGE_WORDS),
        )
        self.assertEqual(book["cover"][1], png(802, 1200, b"1"))

    def test_a_name_given_many_times_in_the_archive_is_one_page(self):
        with tempfile.TemporaryDirectory() as tmp, warnings.catch_warnings():
            warnings.simplefilter(
                "ignore"
            )  # zipfile warns about the duplicate name, which is the point
            path = Path(tmp) / "twice.cbz"
            with zipfile.ZipFile(path, "w") as z:
                for _ in range(20):
                    z.writestr("p.png", png(800, 1200, b"x"))
            self.assertEqual(len(formats.read_cbz(path)["chapters"][0]["blocks"]), 1)

    def test_folders_are_parts_and_the_comic_says_how_it_is_read(self):
        info = (
            b"<ComicInfo><Title>Night Ship</Title><Writer>A. Mori, B. Sato</Writer>"
            b"<Manga>YesAndRightToLeft</Manga></ComicInfo>"
        )
        book = self.read(
            {
                "ComicInfo.xml": info,
                "ch1/1.png": png(800, 1200, b"a"),
                "ch1/2.png": png(800, 1200, b"b"),
                "ch2/1.png": png(800, 1200, b"c"),
            }
        )
        self.assertEqual(
            ([c["title"] for c in book["chapters"]], book["author"], book["rtl"], book["title"]),
            (["ch1", "ch2"], "A. Mori", True, "Night Ship"),
        )

    def test_a_zip_without_pictures_is_refused_with_a_reason(self):
        with self.assertRaisesRegex(ValueError, "zip of pictures"):
            self.read({"readme.txt": b"hello"})


@unittest.skipUnless(HAS_PDF, "needs the pdf extra")
class Pdf(unittest.TestCase):
    def read(self, data: bytes) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "voyage.pdf"
            path.write_bytes(data)
            return formats.read_pdf(path)

    def test_a_book_of_prose_loses_its_running_heads_and_keeps_its_paragraphs(self):
        pages = [
            prose_page(n + 1, "THE VOYAGE OUT", first=f"Chapter {n // 2 + 1}" if n % 2 == 0 else "")
            for n in range(8)
        ]
        book = self.read(make_pdf(pages, outline=[(f"Chapter {n + 1}", n * 2) for n in range(4)]))
        self.assertEqual(
            [c["title"] for c in book["chapters"]],
            ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"],
        )
        text = " ".join(b["t"] for c in book["chapters"] for b in c["blocks"])
        self.assertNotIn("VOYAGE OUT", text)
        self.assertNotRegex(text, r"\b[1-8]\b")
        first = book["chapters"][0]["blocks"]
        self.assertEqual({b["k"] for b in first}, {"p"})
        self.assertGreaterEqual(len(first), 3)  # indents start paragraphs
        self.assertEqual(book["cover"][0], "cover.jpg")

    def test_a_word_broken_at_a_line_end_is_whole_again(self):
        body = [(72, 90 + n * 15, 11, " ".join((SENTENCE * 3).split()[:11])) for n in range(28)]
        body += [
            (72, 90 + 28 * 15, 11, "and the weather held while the ship con-"),
            (72, 90 + 29 * 15, 11, "tinued north. They continued for a week."),
        ]
        book = self.read(make_pdf([[(72, 60, 20, "One"), *body] for _ in range(3)]))
        self.assertIn(
            "the ship continued north",
            " ".join(b["t"] for c in book["chapters"] for b in c["blocks"]),
        )

    def test_a_pdf_without_words_is_kept_as_its_pages(self):
        book = self.read(make_pdf([[(72, 100, 30, "Plate")] for _ in range(3)]))
        self.assertEqual((book["kind"], len(book["chapters"][0]["blocks"])), ("pages", 3))
        page = book["chapters"][0]["blocks"][0]
        self.assertEqual(ingest.image_size(book["pictures"][page["src"]]), (page["w"], page["h"]))
        self.assertEqual(page["text"], "Plate")
