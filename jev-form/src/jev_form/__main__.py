"""`uv run jev-form` / `python -m jev_form` で開発サーバを起動する。"""

from __future__ import annotations

import os


def main() -> None:
    import uvicorn

    uvicorn.run(
        "jev_form.app:app",
        host=os.environ.get("JEV_FORM_HOST", "127.0.0.1"),
        port=int(os.environ.get("JEV_FORM_PORT", "8000")),
        reload=bool(os.environ.get("JEV_FORM_RELOAD")),
    )


if __name__ == "__main__":
    main()
