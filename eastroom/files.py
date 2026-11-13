"""One difference between systems that the rest of the code should not have to know."""

import time
from collections.abc import Callable
from typing import Any, TypeVar

T = TypeVar("T")


def patient(act: Callable[..., T], *args: Any) -> T:
    """Windows refuses to open, replace or move a file while another thread has it open. The
    other side holds it for milliseconds, so the act is tried again for up to a second."""
    for wait in (0.01, 0.03, 0.06, 0.1, 0.2, 0.3, 0.3):
        try:
            return act(*args)
        except PermissionError:
            time.sleep(wait)
    return act(*args)
