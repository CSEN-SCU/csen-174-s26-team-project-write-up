
from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

from openai import OpenAI

HOST = "127.0.0.1"
PORT = 8765
BUILD = "groq-proxy-1"
DEFAULT_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
DOCS_TOKEN_PATH = Path(__file__).with_name("google_token.json")
DOCS_CLIENT_SECRET_GLOB = "client_secret_*.json"
DOCS_SCOPES_WRITE = ["https://www.googleapis.com/auth/documents"]
DOCS_TEXT_MAX_CHARS = int(os.getenv("DOCS_TEXT_MAX_CHARS", "12000"))
CHECK_CACHE_TTL_S = float(os.getenv("CHECK_CACHE_TTL_S", "20"))
CHECK_MAX_ISSUES_PER_TYPE = int(os.getenv("CHECK_MAX_ISSUES_PER_TYPE", "12"))

# Simple in-memory cache: {(doc_id, text_hash): {"at": float, "payload": dict}}
_CHECK_CACHE: dict[tuple[str, str], dict[str, Any]] = {}


def _load_env_teeheehee() -> None:
    """
    Load GROQ_API_KEY from .env.teeheehee sitting next to this file.
    Prefers python-dotenv if available; falls back to a tiny parser.
    """

    env_path = Path(__file__).with_name(".env.teeheehee")
    if not env_path.exists():
        return

    try:
        from dotenv import load_dotenv  # type: ignore

        load_dotenv(dotenv_path=env_path, override=False)
        return
    except Exception:
        pass

    # Minimal fallback: KEY=VALUE lines (supports optional quotes).
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception:
        return


def ask_groq(prompt: str, *, model: str = "openai/gpt-oss-20b") -> str:
    _load_env_teeheehee()

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Missing GROQ_API_KEY. Add it to .env.teeheehee (next to groqapi.py) "
            "or set it in your environment."
        )

    client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    response = client.responses.create(input=prompt, model=model)
    return response.output_text


def _groq_check_prompt(text: str) -> str:
    """
    Ask Groq to return ONLY valid JSON in the shape:
    {
      "issues":[
        {"type":"spelling"|"grammar"|"style","severity":"low"|"medium"|"high",
         "excerpt": "...", "message":"...", "suggestion":"..."}
      ]
    }
    """

    max_each = CHECK_MAX_ISSUES_PER_TYPE
    return (
        "You are a writing assistant. Analyze the provided text and find spelling, grammar, and style issues. "
        "Return ONLY valid JSON (no markdown, no commentary).\n\n"
        "Rules:\n"
        f"- Return at most {max_each} issues per type (spelling/grammar/style).\n"
        "- Only report issues that truly exist in the text.\n"
        "- Keep excerpts short (1-2 sentences) and include the problematic phrase.\n"
        "- Suggestions should be concrete replacements or rewrites.\n"
        "- Do NOT invent quotes not present.\n\n"
        "JSON schema:\n"
        '{\"issues\":[{\"type\":\"spelling|grammar|style\",\"severity\":\"low|medium|high\",\"excerpt\":\"...\",\"message\":\"...\",\"suggestion\":\"...\"}]}\n\n'
        "TEXT:\n"
        + text
    )


def _parse_issues_json(raw: str) -> list[dict[str, Any]]:
    raw = (raw or "").strip()
    if not raw:
        return []

    # Prefer direct JSON parse; if model wrapped with extra text, attempt to extract first {...}.
    obj = None
    try:
        obj = json.loads(raw)
    except Exception:
        m = re.search(r"\{[\s\S]*\}\s*$", raw)
        if m:
            obj = json.loads(m.group(0))

    issues = (obj or {}).get("issues") if isinstance(obj, dict) else None
    if not isinstance(issues, list):
        return []

    normalized: list[dict[str, Any]] = []
    allowed_types = {"spelling", "grammar", "style"}
    allowed_sev = {"low", "medium", "high"}

    per_type: dict[str, int] = {"spelling": 0, "grammar": 0, "style": 0}

    for it in issues:
        if not isinstance(it, dict):
            continue
        t = str(it.get("type") or "").strip().lower()
        if t not in allowed_types:
            continue
        if per_type[t] >= CHECK_MAX_ISSUES_PER_TYPE:
            continue
        sev = str(it.get("severity") or "low").strip().lower()
        if sev not in allowed_sev:
            sev = "low"
        excerpt = str(it.get("excerpt") or "").strip()
        message = str(it.get("message") or "").strip()
        suggestion = str(it.get("suggestion") or "").strip()
        if not excerpt or not message or not suggestion:
            continue
        normalized.append(
            {"type": t, "severity": sev, "excerpt": excerpt, "message": message, "suggestion": suggestion}
        )
        per_type[t] += 1

    return normalized


def check_text_with_groq(*, doc_id: str, text: str, text_hash: str, model: str | None = None) -> dict[str, Any]:
    doc_id = (doc_id or "").strip()
    text = (text or "").strip()
    text_hash = (text_hash or "").strip()
    if not doc_id:
        raise RuntimeError("Missing doc_id.")
    if not text:
        return {"doc_id": doc_id, "issues": [], "model": model or DEFAULT_MODEL, "generated_at": int(time.time() * 1000)}

    key = (doc_id, text_hash or "")
    now = time.time()
    if key[1]:
        cached = _CHECK_CACHE.get(key)
        if cached and (now - float(cached.get("at") or 0)) <= CHECK_CACHE_TTL_S:
            payload = dict(cached.get("payload") or {})
            payload["cached"] = True
            return payload

    chosen_model = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    prompt = _groq_check_prompt(text)
    raw = ask_groq(prompt, model=chosen_model)
    issues = _parse_issues_json(raw)
    payload = {
        "doc_id": doc_id,
        "issues": issues,
        "model": chosen_model,
        "generated_at": int(time.time() * 1000),
        "cached": False,
    }
    if key[1]:
        _CHECK_CACHE[key] = {"at": now, "payload": payload}
    return payload


def _docs_client_secret_path() -> Path:
    here = Path(__file__).resolve().parent
    matches = sorted(here.glob(DOCS_CLIENT_SECRET_GLOB))
    if not matches:
        raise RuntimeError(
            f"Missing Google OAuth client secret JSON. Put {DOCS_CLIENT_SECRET_GLOB} next to groqapi.py."
        )
    return matches[0]


def _token_file_scopes() -> set[str]:
    try:
        raw = DOCS_TOKEN_PATH.read_text(encoding="utf-8")
        data = json.loads(raw) if raw else {}
        scopes = data.get("scopes")
        if isinstance(scopes, str):
            return {s for s in scopes.split() if s}
        if isinstance(scopes, list):
            return {str(s) for s in scopes if s}
        return set()
    except Exception:
        return set()


def _get_google_docs_service(*, scopes: list[str]):
    """
    Returns an authenticated Google Docs API service.
    First run will open a browser to authorize and then cache tokens in google_token.json.
    """

    try:
        from google.auth.transport.requests import Request  # type: ignore
        from google.oauth2.credentials import Credentials  # type: ignore
        from google_auth_oauthlib.flow import InstalledAppFlow  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "Missing Google API dependencies. Install: "
            "pip install google-api-python-client google-auth google-auth-oauthlib"
        ) from e

    creds = None
    need = set(scopes or [])
    if DOCS_TOKEN_PATH.exists():
        # If the cached token doesn't actually include the requested scopes,
        # don't try to reuse it (refresh will keep the old limited scopes).
        have_in_file = _token_file_scopes()
        if need and have_in_file and not need.issubset(have_in_file):
            creds = None
        else:
            creds = Credentials.from_authorized_user_file(str(DOCS_TOKEN_PATH), scopes=scopes)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(_docs_client_secret_path()), scopes=scopes)
            creds = flow.run_local_server(port=0)
        DOCS_TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")

    return build("docs", "v1", credentials=creds, cache_discovery=False)


def _extract_doc_text(doc: dict[str, Any]) -> str:
    parts: list[str] = []
    body = (doc.get("body") or {}).get("content") or []
    for el in body:
        paragraph = el.get("paragraph")
        if not paragraph:
            continue
        for pe in paragraph.get("elements") or []:
            tr = (pe.get("textRun") or {}).get("content")
            if tr:
                parts.append(str(tr))
    return "".join(parts)


def get_doc_text(doc_id: str, *, max_chars: int = DOCS_TEXT_MAX_CHARS) -> dict[str, Any]:
    doc_id = (doc_id or "").strip()
    if not doc_id:
        raise RuntimeError("Missing doc_id.")

    service = _get_google_docs_service(scopes=DOCS_SCOPES_WRITE)
    doc = service.documents().get(documentId=doc_id).execute()
    text = _extract_doc_text(doc)
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    truncated = False
    if max_chars and len(text) > max_chars:
        text = text[:max_chars]
        truncated = True

    # Stable digest for caching on the client/server.
    try:
        import hashlib

        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    except Exception:
        text_hash = ""

    return {
        "doc_id": doc_id,
        "title": (doc.get("title") or ""),
        "text": text,
        "char_count": len(text),
        "truncated": truncated,
        "text_hash": text_hash,
        "build": BUILD,
    }


def count_buzz_in_doc(doc_id: str) -> int:
    doc_id = (doc_id or "").strip()
    if not doc_id:
        raise RuntimeError("Missing doc_id.")

    # Use the same (write-capable) scope everywhere so you don't get prompted twice.
    service = _get_google_docs_service(scopes=DOCS_SCOPES_WRITE)
    doc = service.documents().get(documentId=doc_id).execute()
    text = _extract_doc_text(doc)
    return len(re.findall(r"\bbuzz\b", text, flags=re.IGNORECASE))


def highlight_buzz_in_doc(doc_id: str) -> dict[str, Any]:
    """
    Applies a red highlight background to every whole-word "buzz" occurrence.
    Returns counts and whether an update was applied.
    """

    doc_id = (doc_id or "").strip()
    if not doc_id:
        raise RuntimeError("Missing doc_id.")

    service = _get_google_docs_service(scopes=DOCS_SCOPES_WRITE)
    doc = service.documents().get(documentId=doc_id).execute()
    body = (doc.get("body") or {}).get("content") or []

    pattern = re.compile(r"\bbuzz\b", flags=re.IGNORECASE)
    requests: list[dict[str, Any]] = []
    match_count = 0

    for el in body:
        paragraph = el.get("paragraph")
        if not paragraph:
            continue
        for pe in paragraph.get("elements") or []:
            tr = pe.get("textRun") or {}
            content = tr.get("content")
            if not content:
                continue

            start_index = pe.get("startIndex")
            if start_index is None:
                continue

            for m in pattern.finditer(str(content)):
                s = int(start_index) + int(m.start())
                e = int(start_index) + int(m.end())
                match_count += 1
                requests.append(
                    {
                        "updateTextStyle": {
                            "range": {"startIndex": s, "endIndex": e},
                            "textStyle": {
                                "backgroundColor": {
                                    "color": {
                                        # Soft red highlight (not pure neon).
                                        "rgbColor": {"red": 1.0, "green": 0.55, "blue": 0.55}
                                    }
                                },
                                "foregroundColor": {"color": {"rgbColor": {"red": 0.0, "green": 0.0, "blue": 0.0}}},
                            },
                            "fields": "backgroundColor,foregroundColor",
                        }
                    }
                )

    if not requests:
        return {"doc_id": doc_id, "word": "buzz", "matches": 0, "updated": False}

    service.documents().batchUpdate(documentId=doc_id, body={"requests": requests}).execute()
    return {"doc_id": doc_id, "word": "buzz", "matches": match_count, "updated": True}


def reset_buzz_style_in_doc(doc_id: str) -> dict[str, Any]:
    """
    Removes highlight/background from every whole-word "buzz" occurrence and
    sets the text color back to black.
    """

    doc_id = (doc_id or "").strip()
    if not doc_id:
        raise RuntimeError("Missing doc_id.")

    service = _get_google_docs_service(scopes=DOCS_SCOPES_WRITE)
    doc = service.documents().get(documentId=doc_id).execute()
    body = (doc.get("body") or {}).get("content") or []

    pattern = re.compile(r"\bbuzz\b", flags=re.IGNORECASE)
    requests: list[dict[str, Any]] = []
    match_count = 0

    for el in body:
        paragraph = el.get("paragraph")
        if not paragraph:
            continue
        for pe in paragraph.get("elements") or []:
            tr = pe.get("textRun") or {}
            content = tr.get("content")
            if not content:
                continue

            start_index = pe.get("startIndex")
            if start_index is None:
                continue

            for m in pattern.finditer(str(content)):
                s = int(start_index) + int(m.start())
                e = int(start_index) + int(m.end())
                match_count += 1

                # Clear highlight/background back to default.
                requests.append(
                    {
                        "updateTextStyle": {
                            "range": {"startIndex": s, "endIndex": e},
                            "textStyle": {},
                            "fields": "backgroundColor",
                        }
                    }
                )
                # Force foreground back to black.
                requests.append(
                    {
                        "updateTextStyle": {
                            "range": {"startIndex": s, "endIndex": e},
                            "textStyle": {
                                "foregroundColor": {"color": {"rgbColor": {"red": 0.0, "green": 0.0, "blue": 0.0}}}
                            },
                            "fields": "foregroundColor",
                        }
                    }
                )

    if not requests:
        return {"doc_id": doc_id, "word": "buzz", "matches": 0, "updated": False}

    service.documents().batchUpdate(documentId=doc_id, body={"requests": requests}).execute()
    return {"doc_id": doc_id, "word": "buzz", "matches": match_count, "updated": True}


class GroqHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("X-Proxy-Build", BUILD)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        path = (self.path or "").split("?", 1)[0]
        if path not in (
            "/api/generate",
            "/api/buzz",
            "/api/buzz/highlight",
            "/api/buzz/reset",
            "/api/docs/text",
            "/api/docs/check",
        ):
            self.send_error(404)
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = (self.path or "").split("?", 1)[0]
        if path == "/api/status":
            self._send_json(
                200,
                {
                    "ok": True,
                    "build": BUILD,
                    "provider": "groq",
                    "model": DEFAULT_MODEL,
                    "docs_auth": str(DOCS_TOKEN_PATH.exists()).lower(),
                },
            )
            return

        if path == "/api/buzz":
            try:
                q = urllib.parse.urlparse(self.path).query
                qs = urllib.parse.parse_qs(q)
                doc_id = (qs.get("doc_id") or [""])[0]
                count = count_buzz_in_doc(doc_id)
            except Exception as e:
                self._send_json(502, {"error": f"{type(e).__name__}: {e}", "build": BUILD})
                return
            self._send_json(200, {"doc_id": doc_id, "word": "buzz", "count": count, "build": BUILD})
            return

        if path == "/api/docs/text":
            try:
                q = urllib.parse.urlparse(self.path).query
                qs = urllib.parse.parse_qs(q)
                doc_id = (qs.get("doc_id") or [""])[0]
                payload = get_doc_text(doc_id)
            except Exception as e:
                self._send_json(502, {"error": f"{type(e).__name__}: {e}", "build": BUILD})
                return
            self._send_json(200, payload)
            return

        if path == "/api/buzz/highlight":
            try:
                q = urllib.parse.urlparse(self.path).query
                qs = urllib.parse.parse_qs(q)
                doc_id = (qs.get("doc_id") or [""])[0]
                result = highlight_buzz_in_doc(doc_id)
            except Exception as e:
                self._send_json(502, {"error": f"{type(e).__name__}: {e}", "build": BUILD})
                return
            self._send_json(200, {"build": BUILD, **result})
            return

        if path == "/api/buzz/reset":
            try:
                q = urllib.parse.urlparse(self.path).query
                qs = urllib.parse.parse_qs(q)
                doc_id = (qs.get("doc_id") or [""])[0]
                result = reset_buzz_style_in_doc(doc_id)
            except Exception as e:
                self._send_json(502, {"error": f"{type(e).__name__}: {e}", "build": BUILD})
                return
            self._send_json(200, {"build": BUILD, **result})
            return

        if path != "/api/status":
            self.send_error(404)
            return

    def do_POST(self) -> None:
        path = (self.path or "").split("?", 1)[0]
        if path not in ("/api/generate", "/api/docs/check"):
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"

        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        if path == "/api/generate":
            prompt = (data.get("prompt") or "").strip()
            if not prompt:
                self._send_json(400, {"error": "Missing or empty prompt"})
                return

            model = (data.get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL

            try:
                text = ask_groq(prompt, model=model)
            except Exception as e:
                self._send_json(502, {"error": f"{type(e).__name__}: {e}", "build": BUILD, "model": model})
                return

            self._send_json(200, {"text": text, "build": BUILD, "provider": "groq", "model": model})
            return

        if path == "/api/docs/check":
            try:
                doc_id = str(data.get("doc_id") or "").strip()
                text = str(data.get("text") or "")
                text_hash = str(data.get("text_hash") or "").strip()
                model = str(data.get("model") or "").strip() or None
                payload = check_text_with_groq(doc_id=doc_id, text=text, text_hash=text_hash, model=model)
            except Exception as e:
                self._send_json(502, {"error": f"{type(e).__name__}: {e}", "build": BUILD})
                return
            self._send_json(200, {"build": BUILD, **payload})
            return

        self.send_error(404)
        return


def main() -> None:
    _load_env_teeheehee()
    server = HTTPServer((HOST, PORT), GroqHandler)
    print(f"{BUILD} listening on http://{HOST}:{PORT} (POST /api/generate)", flush=True)
    print("GET /api/status to confirm provider/model", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
