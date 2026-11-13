"""The voices that can make narration. Each returns `speak(text) -> (16-bit mono PCM bytes, sample
rate)` for eastroom.voice.narrate.

Their packages are optional extras: the reader and the importer never need them.
  plain        Kokoro (82M). Several times faster than real time on any computer.
               pip install "eastroom[voice]"
  storyteller  Qwen3-TTS (1.7B) with a reference voice. Apple chips only, slower than real time.
               pip install "eastroom[storyteller]"
"""

from __future__ import annotations

import hashlib
import importlib
import os
import re
import subprocess
import sys
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

STORE = Path(os.environ.get("EASTROOM_VOICE_DIR") or Path.home() / ".cache" / "eastroom" / "voice")
# name: (sha256, address); checked after download so a damaged or altered file is never loaded
KOKORO_FILES = {
    "kokoro-v1.0.onnx": (
        "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    ),
    "voices-v1.0.bin": (
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
    ),
}
MIN_FREE_MEMORY = (
    30  # per cent; the storyteller model needs several GB and must not push the machine into swap
)


def _model_file(name: str) -> Path:
    path = STORE / name
    digest, address = KOKORO_FILES[name]
    if not path.is_file():
        STORE.mkdir(parents=True, exist_ok=True)
        print(f"Fetching {name} (once) ...", file=sys.stderr)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(
            address, tmp
        )  # a fixed https address, checked against its checksum below
        tmp.replace(path)
    found = hashlib.sha256(path.read_bytes()).hexdigest()
    if found != digest:
        raise RuntimeError(
            f"{path} is not the file East Room expects (its checksum differs)."
            " Delete it and run again."
        )
    return path


def _pcm(samples: Any, rate: int) -> tuple[bytes, int]:
    np = importlib.import_module("numpy")

    a = np.asarray(samples, dtype=np.float32).reshape(-1)
    loud = np.where(np.abs(a) > (np.abs(a).max() if len(a) else 0) * 0.02)[0]
    if len(
        loud
    ):  # the silence a model leaves at either end would add up over thousands of sentences
        a = a[max(0, loud[0] - int(0.03 * rate)) : loud[-1] + int(0.08 * rate)]
    return (np.clip(a, -1, 1) * 32767).astype("<i2").tobytes(), rate


def plain(voice: str = "af_bella") -> Callable[[str], tuple[bytes, int]]:
    try:
        kokoro = importlib.import_module("kokoro_onnx")
    except ImportError as err:
        raise RuntimeError(
            'The plain voice is not installed. Run: pip install "eastroom[voice]"'
        ) from err
    model = kokoro.Kokoro(str(_model_file("kokoro-v1.0.onnx")), str(_model_file("voices-v1.0.bin")))

    def speak(text: str) -> tuple[bytes, int]:
        samples, rate = model.create(text, voice=voice, speed=1.0, lang="en-us")
        return _pcm(samples, rate)

    return speak


def storyteller(library: Path) -> Callable[[str], tuple[bytes, int]]:
    """The owner's storyteller: a reference recording and its words in
    <library>/storyteller/ (ref.wav, ref.txt)."""
    ref, ref_text = library / "storyteller" / "ref.wav", library / "storyteller" / "ref.txt"
    if not (ref.is_file() and ref_text.is_file()):
        raise RuntimeError(
            "The storyteller needs a reference voice:"
            f" put ref.wav and ref.txt (the words spoken in it) in {ref.parent}"
        )
    if sys.platform == "darwin":
        free = int(
            subprocess.run(
                ["sysctl", "-n", "kern.memorystatus_level"], capture_output=True, text=True
            ).stdout
            or 100
        )
        if free < MIN_FREE_MEMORY:
            raise RuntimeError(
                f"Only {free}% of memory is free."
                " The storyteller model needs several GB: close some apps and run again."
            )
    try:
        np = importlib.import_module("numpy")

        tts = importlib.import_module("mlx_audio.tts.utils")
    except ImportError as err:
        raise RuntimeError(
            "The storyteller is not installed (Apple chips only)."
            ' Run: pip install "eastroom[storyteller]"'
        ) from err
    model, words = (
        tts.load("mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"),
        ref_text.read_text(encoding="utf-8").strip(),
    )

    def speak(text: str) -> tuple[bytes, int]:
        # the model hurries through punctuation on long passes, so a long
        # sentence is spoken clause by clause with our own short rests
        clauses = (
            [c.strip() for c in re.split(r"(?<=[;:])\s+|\s*—\s*", text) if c.strip()]
            if len(text.split()) > 20
            else [text]
        )
        parts: list[Any] = []
        rate = 24000
        for n, clause in enumerate(clauses):
            last = n == len(clauses) - 1
            for result in model.generate(
                text=clause if last or clause[-1] in ";:," else clause + ",",
                ref_audio=str(ref),
                ref_text=words,
                lang_code="a",
            ):
                parts.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
                rate = result.sample_rate
            if not last:
                parts.append(np.zeros(int(rate * 0.17), dtype=np.float32))
        return _pcm(np.concatenate(parts) if parts else np.zeros(1, dtype=np.float32), rate)

    return speak
