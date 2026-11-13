"""Checks for JSON read from disk or sent by a page, which arrives with no type of its own."""

from __future__ import annotations

from typing import Any, TypeGuard


def is_object(value: object) -> TypeGuard[dict[str, Any]]:
    return isinstance(value, dict)


def is_list(value: object) -> TypeGuard[list[Any]]:
    return isinstance(value, list)
