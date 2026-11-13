"""Puts the Python runtime a published copy needs beside it, so visitors can add their own books.

    python tools/demo_runtime.py SITE

A published copy has no Home. When a visitor adds a file there, their own browser reads it with
East Room's Python, which runs in WebAssembly on Pyodide (web/local.js). The page loads nothing from
other sites, so the runtime is served with it: this fetches the pinned release from Pyodide's
GitHub releases, checks it against the hash below and unpacks the five files that are used.
"""

from __future__ import annotations

import hashlib
import io
import sys
import tarfile
import urllib.request
from pathlib import Path

VERSION = "314.0.7"
SHA256 = "2abdcc2e35208af406e07724cffa85bc582ced97e9028383ecf5462541393f95"
URL = (
    f"https://github.com/pyodide/pyodide/releases/download/{VERSION}/pyodide-core-{VERSION}.tar.bz2"
)
USED = (
    "pyodide.mjs",
    "pyodide.asm.mjs",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
)


def main(site: Path) -> int:
    folder = f"pyodide/{VERSION}/"
    if f"'{folder}'" not in (site / "local.js").read_text(encoding="utf-8"):
        print(f"local.js does not load {folder}: change both together.", file=sys.stderr)
        return 1
    with urllib.request.urlopen(URL, timeout=120) as answer:
        packed = answer.read()
    if hashlib.sha256(packed).hexdigest() != SHA256:
        print("The download is not the release this was checked against.", file=sys.stderr)
        return 1
    (site / folder).mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(packed), mode="r:bz2") as release:
        for name in USED:
            member = release.extractfile(f"pyodide/{name}")
            assert member, name
            (site / folder / name).write_bytes(member.read())
    print(f"Pyodide {VERSION} is in {site / folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
