"""What Home can do on this machine: which engines are present, and whether Home
starts when the owner logs in."""

from __future__ import annotations

import contextlib
import importlib
import os
import plistlib
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from . import engines as ask
from . import work

LABEL = "eastroom.home"
AGENT = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
_voices: dict[str, Any] = {"at": 0.0, "found": {}}


def engines(library: Path, workshop: work.Workshop) -> dict[str, Any]:
    """Checked when the owner opens the Engines room. Looking for a voice's packages starts Python,
    so that answer is kept for ten minutes."""
    chosen = work.settings(library)
    out: dict[str, Any] = {
        "tools": ask.tools(),
        "apis": [],
        "ffmpeg": bool(shutil.which("ffmpeg") or shutil.which("afconvert")),
        "login": {"can": sys.platform == "darwin", "on": starts_at_login(library)},
        "pdf": False,
    }
    held = ask.keys(library, chosen)
    for api in chosen["apis"]:
        entry: dict[str, Any] = {
            **api,
            "key": api["id"] in held,
            "local": ask.local(api["url"]),
            "up": False,
            "models": [],
            "error": "",
        }
        try:
            entry["models"], entry["up"] = ask.models(api["url"], held.get(api["id"], "")), True
        except (RuntimeError, ValueError, KeyError, TypeError) as err:
            entry["error"] = str(err)
        out["apis"].append(entry)
    if time.time() - _voices["at"] > 600:
        _voices.update(
            at=time.time(), found={name: bool(workshop.python_for(name)) for name in work.VOICES}
        )
    out["voices"] = dict(_voices["found"])
    out["storyteller_ref"] = (library / "storyteller" / "ref.wav").is_file()
    with contextlib.suppress(ImportError):
        importlib.import_module("pypdfium2")

        out["pdf"] = True
    return out


def starts_at_login(library: Path) -> bool:
    """True when the login entry starts a Home for this library. Another
    library's entry is not this one's."""
    try:
        with AGENT.open("rb") as f:
            return str(library) in plistlib.load(f).get("ProgramArguments", [])
    except (OSError, ValueError):
        return False


def at_login(on: bool, library: Path, port: int, origins: list[str]) -> dict[str, Any]:
    """Writes or removes the entry that starts Home at login. It takes effect at the next login; the
    Home that is running is left alone."""
    if sys.platform != "darwin":
        raise ValueError(
            "Starting with the computer is set up by hand on this system. See docs/setup.md."
        )
    if on:
        command = [
            sys.executable,
            "-u",
            "-m",
            "eastroom",
            "--no-open",
            "--library",
            str(library),
            "--port",
            str(port),
        ]
        for origin in origins:
            command += ["--origin", origin]
        AGENT.parent.mkdir(parents=True, exist_ok=True)
        with AGENT.open("wb") as f:
            plistlib.dump(
                {
                    "Label": LABEL,
                    "ProgramArguments": command,
                    "WorkingDirectory": str(Path(__file__).parents[1]),
                    "RunAtLoad": True,
                    "EnvironmentVariables": {"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
                    "ProcessType": "Background",
                },
                f,
            )
    elif starts_at_login(library):  # never the entry of another library
        with contextlib.suppress(OSError):
            subprocess.run(
                ["launchctl", "bootout", f"gui/{os.getuid()}/{LABEL}"],
                capture_output=True,
                timeout=10,
            )
        AGENT.unlink(missing_ok=True)
    return {"on": starts_at_login(library)}
