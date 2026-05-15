"""Shared error helpers for the app-api Flask backend.

Maps Firestore / google.api_core exceptions to clean HTTP statuses + safe
error codes, and provides safe_firestore() so route handlers don't have to
repeat try/except boilerplate or risk leaking raw Python tracebacks to the
browser.
"""

import logging

log = logging.getLogger(__name__)


_FIRESTORE_ERROR_MAP = {
    "PermissionDenied": ("firestore_forbidden", 403),
    "Unauthenticated": ("firestore_unauthenticated", 401),
    "NotFound": ("not_found", 404),
    "AlreadyExists": ("already_exists", 409),
    "FailedPrecondition": ("failed_precondition", 412),
    "DeadlineExceeded": ("firestore_timeout", 504),
    "ResourceExhausted": ("firestore_quota", 429),
    "Unavailable": ("firestore_unavailable", 503),
}


class ApiError(Exception):
    """Structured error for backend route handlers to raise / return."""

    def __init__(self, code: str, status: int, message: str = ""):
        self.code = code
        self.status = status
        self.message = message
        super().__init__(message or code)


class FirebaseNotConfiguredError(Exception):
    """Raised when Firebase Admin was never initialized (missing service account env)."""


def firestore_to_api_error(exc: Exception) -> ApiError:
    if isinstance(exc, FirebaseNotConfiguredError):
        log.warning("Firestore skipped: %s", exc)
        return ApiError(
            code="firestore_unconfigured",
            status=503,
            message=str(exc) or "Firebase credentials not configured",
        )
    name = type(exc).__name__
    if name == "DefaultCredentialsError":
        log.warning(
            "Firestore / Firebase ADC missing (set FIREBASE_CREDENTIALS_PATH or FIREBASE_SERVICE_ACCOUNT_JSON): %s",
            exc,
        )
        return ApiError(
            code="firestore_unconfigured",
            status=503,
            message="Application default credentials not configured",
        )
    code, status = _FIRESTORE_ERROR_MAP.get(name, ("firestore_unavailable", 503))
    log.exception("Firestore error %s -> %s", name, code)
    return ApiError(code=code, status=status, message=name)


def safe_firestore(fn, *, fallback=None):
    """Run a Firestore call, returning (result, ApiError | None).

    Routes can use this to keep Firestore failures out of the response body
    and decide independently whether to fall back or surface the error.
    """
    try:
        return fn(), None
    except Exception as exc:  # noqa: BLE001 - intentional broad catch at boundary
        return fallback, firestore_to_api_error(exc)
