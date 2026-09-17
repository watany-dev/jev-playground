"""Jev の型付き確率評価を使った47都道府県あてサンプルフォーム。"""

from .app import create_app
from .gateway import JevClient, JevError

__all__ = ["create_app", "JevClient", "JevError"]
