from errors import ApiError, firestore_to_api_error, safe_firestore


class FakeNotFound(Exception):
    """Stand-in for google.api_core.exceptions.NotFound (matched by class name)."""


# Class name must match the entry in _FIRESTORE_ERROR_MAP.
FakeNotFound.__name__ = "NotFound"


def test_firestore_not_found_maps_to_404():
    err = firestore_to_api_error(FakeNotFound("missing"))
    assert isinstance(err, ApiError)
    assert err.status == 404
    assert err.code == "not_found"


def test_unknown_exception_falls_back_to_503():
    err = firestore_to_api_error(RuntimeError("kaboom"))
    assert err.status == 503
    assert err.code == "firestore_unavailable"


def test_safe_firestore_returns_value_when_callable_succeeds():
    value, err = safe_firestore(lambda: [1, 2, 3], fallback=[])
    assert value == [1, 2, 3]
    assert err is None


def test_safe_firestore_returns_fallback_and_error_on_failure():
    def boom():
        raise RuntimeError("network down")

    value, err = safe_firestore(boom, fallback=[])
    assert value == []
    assert isinstance(err, ApiError)
    assert err.code == "firestore_unavailable"
    assert err.status == 503
