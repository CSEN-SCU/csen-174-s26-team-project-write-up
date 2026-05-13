"""Shared Flask extensions (avoid circular imports with route blueprints)."""

import os

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

_storage_uri = os.environ.get("APP_LIMITER_STORAGE_URI", "memory://").strip() or "memory://"

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],
    storage_uri=_storage_uri,
    headers_enabled=True,
)
