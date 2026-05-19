import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app import app  # noqa: F401  — Vercel picks up the ASGI `app`
