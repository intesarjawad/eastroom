"""Builds a small EPUB in memory so the tests need no book files."""

import io
import zipfile

CONTAINER = (
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    '<rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'
)
PARAGRAPH = (
    "<p>"
    + "The sea was calm that morning and nobody on deck expected the weather to turn. " * 4
    + "</p>"
)


def make_epub(
    documents: list[str],
    creator: str = "Jane Austen",
    file_as: str = "Austen, Jane",
    locked: bool = False,
    cover: tuple[str, bytes] | None = None,
    spine_repeats: int = 1,
    files: dict[str, bytes] | None = None,
    fixed: bool = False,
) -> bytes:
    """`documents` are XHTML body fragments, one per spine file. `cover` is (file name, bytes),
    declared as an image whatever its name says.

    `files` are further entries beside the documents, such as pictures.
    """
    manifest = "".join(
        f'<item id="d{i}" href="d{i}.xhtml" media-type="application/xhtml+xml"/>'
        for i in range(len(documents))
    )
    if cover:
        manifest += (
            f'<item id="cover" href="{cover[0]}" media-type="image/png" properties="cover-image"/>'
        )
    spine = "".join(f'<itemref idref="d{i}"/>' for i in range(len(documents))) * spine_repeats
    layout = '<meta property="rendition:layout">pre-paginated</meta>' if fixed else ""
    opf = (
        '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>'
        f'<dc:title>A Test Book</dc:title><dc:creator id="a0">{creator}</dc:creator>'
        f'<meta refines="#a0" property="file-as">{file_as}</meta>{layout}</metadata>'
        f"<manifest>{manifest}</manifest><spine>{spine}</spine></package>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("META-INF/container.xml", CONTAINER)
        z.writestr("OEBPS/content.opf", opf)
        if locked:  # what a shop's copy protection leaves in the file
            z.writestr(
                "META-INF/encryption.xml",
                '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">'
                '<EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>',
            )
        if cover:
            z.writestr(f"OEBPS/{cover[0]}", cover[1])
        for name, data in (files or {}).items():
            z.writestr(f"OEBPS/{name}", data)
        for i, body in enumerate(documents):
            z.writestr(
                f"OEBPS/d{i}.xhtml",
                f"<html><head><title>x</title></head><body>{body}</body></html>",
            )
    return buffer.getvalue()


def png(width: int, height: int, salt: bytes = b"") -> bytes:
    """The first bytes of a PNG of this size: enough for anything that
    only asks how large a picture is."""
    return (
        b"\x89PNG\r\n\x1a\n"
        + (13).to_bytes(4, "big")
        + b"IHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + b"\x08\x02\x00\x00\x00"
        + salt
    )
