def ensure_firebase_app():
    """Initialize Firebase Admin SDK once (needed for Auth verify_id_token)."""
    import firebase_admin
    from firebase_admin import credentials
    from python_dotenv import load_dotenv

    load_dotenv()

    try:
        firebase_admin.get_app()
        return
    except ValueError:
        pass

    # 1. Try FIREBASE_CREDENTIALS as inline JSON
    raw_json = os.environ.get("FIREBASE_CREDENTIALS", "").strip()
    if raw_json:
        firebase_admin.initialize_app(credentials.Certificate(json.loads(raw_json)))
        return

    # 2. Try FIREBASE_CREDENTIALS_PATH as a path to a JSON file
    cred_path_raw = os.environ.get("FIREBASE_CREDENTIALS_PATH", "").strip()
    resolved = _resolve_credentials_path(cred_path_raw)
    if resolved:
        firebase_admin.initialize_app(credentials.Certificate(resolved))
        return

    # 3. Neither worked — raise an error
    raise FirebaseNotConfiguredError(
        "Firebase credentials not found. Set FIREBASE_CREDENTIALS (JSON string) "
        "or FIREBASE_CREDENTIALS_PATH (path to JSON file) in your environment."
    )