"""
Write Up prototype API: POST /api/feedback → Groq Llama 3.3 70B writing feedback.

Run:
  cd prototypes/ishika/server && pip install -r requirements.txt && python app.py

Then open:
  http://127.0.0.1:5050/  (landing)
  http://127.0.0.1:5050/feedback.html  (full-page feedback)

Chrome extension (``prototypes/ishika/extension``) calls ``POST /api/feedback``; CORS is enabled for ``/api/*``.
For MCP mode, ``POST /api/mcp/call`` is a local bridge for ``google_docs.get_document_text``.

Vocabulary upgrades are parsed from the model reply and stored in local SQLite (``writeup.db``) for later prompts.

Groq usage matches the SDK default: ``client = Groq()`` uses ``GROQ_API_KEY``
from the environment after ``load_dotenv`` loads ``.env.ishika``.
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS
from groq import Groq

from db import get_word_bank, init_db, insert_vocab_pairs, vocabulary_context_for_prompt

ISHika_ROOT = Path(__file__).resolve().parent.parent
LANDING_DIR = ISHika_ROOT / "landing"
ENV_FILE = ISHika_ROOT / ".env.ishika"


def load_ishika_env() -> None:
    """Load variables from prototypes/ishika/.env.ishika (custom filename, not only `.env`)."""
    if not ENV_FILE.is_file():
        return
    load_dotenv(ENV_FILE, override=True)
    try:
        raw = ENV_FILE.read_text(encoding="utf-8-sig")
    except OSError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            os.environ[key] = val

    if not (os.environ.get("GROQ_API_KEY") or "").strip():
        alt = (os.environ.get("OPENAI_API_KEY") or "").strip()
        if alt.startswith("gsk_"):
            os.environ["GROQ_API_KEY"] = alt


load_ishika_env()

GROQ_MODEL = "llama-3.3-70b-versatile"
MAX_INPUT_CHARS = 16_000
MAX_OUTPUT_TOKENS = 2_048
MAX_LIVE_INPUT_CHARS = 9_000
MAX_LIVE_OUTPUT_TOKENS = 640

ALLOWED_FOCUS = frozenset({"vocabulary", "tone", "clarity"})
VOCAB_JSON_TAG = "<<<WRITEUP_VOCAB_JSON>>>"

ALLOWED_LANDING_FILES = frozenset({"index.html", "feedback.html", "styles.css"})

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

init_db()


def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def _extract_text_from_mcp_payload(payload) -> str:
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload.strip()
    if isinstance(payload, dict):
        for key in ("documentText", "text", "output_text", "output", "content"):
            val = payload.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        for nested in ("result", "data", "response"):
            got = _extract_text_from_mcp_payload(payload.get(nested))
            if got:
                return got
    if isinstance(payload, list):
        parts = []
        for item in payload:
            txt = _extract_text_from_mcp_payload(item)
            if txt:
                parts.append(txt)
        return "\n".join(parts).strip()
    return ""


def _docs_api_text_from_document_payload(doc_payload: dict) -> str:
    """
    Convert Google Docs API `documents.get` payload into plain text.
    """
    body = doc_payload.get("body") if isinstance(doc_payload, dict) else None
    content = body.get("content") if isinstance(body, dict) else None
    if not isinstance(content, list):
        return ""

    chunks: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        para = block.get("paragraph")
        if not isinstance(para, dict):
            continue
        elements = para.get("elements")
        if not isinstance(elements, list):
            continue
        for el in elements:
            if not isinstance(el, dict):
                continue
            text_run = el.get("textRun")
            if not isinstance(text_run, dict):
                continue
            txt = text_run.get("content")
            if isinstance(txt, str):
                chunks.append(txt)

    joined = "".join(chunks)
    # Remove excessive blank lines while preserving paragraph breaks.
    joined = re.sub(r"\n{3,}", "\n\n", joined).strip()
    return joined


def _local_google_docs_tool_call(tool_name: str, arguments: dict) -> dict:
    """
    Local MCP bridge implementation for Google Docs text retrieval.
    """
    normalized = (tool_name or "").strip().lower()
    allowed_tools = {
        "google_docs.get_document_text",
        "google.docs.get_document_text",
        "google-docs.get_document_text",
    }
    if normalized not in allowed_tools:
        raise RuntimeError(
            f'Unsupported local MCP tool "{tool_name}". Use one of: '
            + ", ".join(sorted(allowed_tools))
        )

    doc_id = str(
        (arguments or {}).get("document_id")
        or (arguments or {}).get("doc_id")
        or ""
    ).strip()
    if not doc_id:
        raise RuntimeError("Missing document_id/doc_id for MCP bridge tool call.")

    access_token = (os.environ.get("GOOGLE_DOCS_ACCESS_TOKEN") or "").strip()
    if not access_token:
        raise RuntimeError(
            "GOOGLE_DOCS_ACCESS_TOKEN is not set. "
            "Set an OAuth access token with https://www.googleapis.com/auth/documents.readonly scope."
        )

    url = (
        "https://docs.googleapis.com/v1/documents/"
        + urllib.parse.quote(doc_id, safe="")
    )
    req = urllib.request.Request(url=url, method="GET")
    req.add_header("Authorization", f"Bearer {access_token}")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Google Docs API HTTP {e.code}: {detail[:300]}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Google Docs API connection failed: {e.reason}") from e

    try:
        doc_payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError("Google Docs API returned invalid JSON.") from e

    plain_text = _docs_api_text_from_document_payload(doc_payload)
    if not plain_text:
        raise RuntimeError("Google Docs API returned an empty document body.")

    return {
        "ok": True,
        "tool": tool_name,
        "result": {
            "documentId": doc_id,
            "documentText": plain_text,
        },
    }


def fetch_doc_text_via_mcp_bridge(doc_id: str) -> str:
    """
    Experimental MCP bridge call.

    Expected env:
      GOOGLE_DOCS_MCP_BRIDGE_URL=http://127.0.0.1:8787/mcp/call
    Optional:
      GOOGLE_DOCS_MCP_TOOL=google_docs.get_document_text
      GOOGLE_DOCS_MCP_AUTH_BEARER=...
    """
    tool = (os.environ.get("GOOGLE_DOCS_MCP_TOOL") or "google_docs.get_document_text").strip()
    url = (os.environ.get("GOOGLE_DOCS_MCP_BRIDGE_URL") or "").strip()
    if not url:
        data = _local_google_docs_tool_call(
            tool,
            {"document_id": doc_id, "doc_id": doc_id},
        )
        text = _extract_text_from_mcp_payload(data)
        if not text:
            raise RuntimeError("Local MCP bridge did not return document text.")
        return text

    token = (os.environ.get("GOOGLE_DOCS_MCP_AUTH_BEARER") or "").strip()

    payload = {
        "name": tool,
        "arguments": {"document_id": doc_id, "doc_id": doc_id},
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url=url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"MCP bridge HTTP {e.code}: {detail[:200]}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"MCP bridge connection failed: {e.reason}") from e

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError("MCP bridge returned non-JSON response.") from e

    text = _extract_text_from_mcp_payload(data)
    if not text:
        raise RuntimeError("MCP bridge response did not include document text.")
    return text


@app.post("/api/mcp/call")
def mcp_call_bridge():
    """
    Local HTTP MCP bridge endpoint for Google Docs tool calls.
    """
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    arguments = payload.get("arguments")
    if not isinstance(arguments, dict):
        arguments = {}
    if not name:
        return jsonify(error='Provide "name" for MCP tool call.'), 400

    try:
        result = _local_google_docs_tool_call(name, arguments)
    except RuntimeError as e:
        return jsonify(error=str(e)), 502

    return jsonify(result)


def normalize_focus(raw) -> list[str]:
    if isinstance(raw, list):
        out = []
        for x in raw:
            s = str(x).lower().strip()
            if s in ALLOWED_FOCUS and s not in out:
                out.append(s)
        return out
    if isinstance(raw, str) and raw.strip():
        s = raw.lower().strip()
        return [s] if s in ALLOWED_FOCUS else []
    return []


def build_system_prompt(focus_list: list[str], vocab_context: str, *, live_mode: bool = False) -> str:
    labels = ", ".join(focus_list)
    blocks: list[str] = []

    blocks.append(
        "You are Write Up, a learning-first writing coach for students and early-career professionals. "
        "The user pasted their own draft. Preserve their voice and dialect; do not homogenize into generic "
        '"AI English." Do not produce a full rewritten essay—coach with targeted notes only.\n\n'
        f"Selected focus areas (ONLY these): {labels}.\n"
        "Give no dedicated notes for dimensions that were not selected. "
        "If something outside selection is critical for comprehension, mention it in one short line only.\n"
    )

    if "vocabulary" in focus_list:
        v_extra = ""
        if vocab_context.strip():
            v_extra = (
                "\n**Vocabulary memory (this device, earlier sessions):**\n"
                f"{vocab_context.strip()}\n"
                "When the draft reuses a term listed above, briefly point out that they have leaned on that wording before "
                "and remind them of a stronger alternative you already suggested—only if it still fits the new context.\n"
            )
        blocks.append(
            "Focus on word choice and phrasing that reads as informal, vague, repetitive, or below the register they need "
            "(e.g. school vs. workplace). Offer concrete upgrade suggestions: short phrases or single words they can "
            "integrate while keeping their meaning. Prefer compact bullets: In your draft -> Stronger option -> Why. "
            "Aim for professional, precise alternatives—not purple prose.\n"
            + v_extra
        )

    if "tone" in focus_list:
        blocks.append(
            "Comment on formality, confidence, warmth, and fit for the implied audience (e.g. professor, hiring manager). "
            "Suggest small adjustments (wording, hedging, directness)—not a full rewrite.\n"
        )

    if "clarity" in focus_list:
        blocks.append(
            "Comment on sentence length, logic flow, ambiguous references, transitions, and anything that obscures meaning. "
            "Prefer one clear example fix per issue.\n"
        )

    blocks.append(
        "Response shape (concise plain text):\n"
        "- First line: Focus: <selected areas>\n"
        "- Then 3-7 short bullet lines total across selected areas only.\n"
        '- For vocabulary lines, use: "<from>" -> "<to>" — <brief why>\n'
        "- No markdown headings, no ##, no long paragraphs.\n\n"
        "Machine-readable vocabulary block (required every time): After your plain-text feedback, output a blank line, then on its "
        f"own line the exact token `{VOCAB_JSON_TAG}` immediately followed by a single JSON array (no markdown code fence). "
        'Each element must be an object with keys "from" (exact word or short phrase as used in their text), '
        '"to" (stronger replacement they can paste), and "note" (very short rationale). '
        "Include only vocabulary swap suggestions that appear in your feedback above. "
        "If vocabulary was not among the selected focus areas, output an empty array: []. "
        "The JSON must be valid UTF-8 and parseable by json.loads."
    )

    out = "\n".join(blocks)
    if live_mode:
        out += (
            "\n\nLive snapshot mode: the user is actively typing and the text may be partial. "
            "Keep it short: after the Focus line, at most 4 bullets total. "
            "If vocabulary is selected, include no more than 3 JSON objects."
        )
    return out


def parse_vocab_json_suffix(content: str) -> tuple[str, list[dict]]:
    """Strip VOCAB_JSON_TAG + JSON array from the end; return (display_text, pairs)."""
    text = (content or "").strip()
    idx = text.rfind(VOCAB_JSON_TAG)
    if idx == -1:
        return text, []

    before = text[:idx].strip()
    after = text[idx + len(VOCAB_JSON_TAG) :].strip()
    pairs: list[dict] = []

    if not after:
        return before.strip(), pairs

    if after.startswith("```"):
        after = re.sub(r"^```[a-zA-Z]*\s*", "", after)
        after = re.sub(r"\s*```\s*$", "", after).strip()

    try:
        data = json.loads(after)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", after)
        if not m:
            return before.strip(), pairs
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return before.strip(), pairs

    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and item.get("from") and item.get("to"):
                pairs.append(
                    {
                        "from": str(item.get("from", "")).strip(),
                        "to": str(item.get("to", "")).strip(),
                        "note": str(item.get("note", "")).strip(),
                    }
                )

    display = before.strip()
    return display, pairs


def normalize_feedback_text(text: str) -> str:
    """
    Make model output compact for UI:
    - remove markdown headings/markers
    - collapse whitespace
    - keep short bullet-like lines
    """
    lines = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^#{1,6}\s*", "", line)  # remove markdown headings
        line = line.replace("**", "").replace("__", "")
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            lines.append(line)
    if not lines:
        return ""
    return "\n".join(lines)


@app.post("/api/feedback")
def feedback():
    if not (os.environ.get("GROQ_API_KEY") or "").strip():
        hint = (
            "Missing GROQ_API_KEY. Save a line exactly like GROQ_API_KEY=your_key "
            f"in {ENV_FILE} (no spaces around =), then restart the server. "
            "If the key is only in your editor, save the file to disk."
        )
        if ENV_FILE.is_file():
            hint += f" File exists ({ENV_FILE.stat().st_size} bytes) but GROQ_API_KEY is still empty."
        return jsonify(error=hint), 500

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    focus_list = normalize_focus(data.get("focus"))
    live = _as_bool(data.get("live"))
    use_mcp = _as_bool(data.get("use_mcp"))
    doc_id = str(data.get("doc_id") or "").strip()

    if not focus_list:
        return jsonify(
            error='Select at least one focus area. Send "focus" as a JSON array containing '
            '"vocabulary", "tone", and/or "clarity" (e.g. ["vocabulary","tone"]).'
        ), 400

    if use_mcp:
        if not doc_id:
            return jsonify(error='When "use_mcp" is true, provide "doc_id".'), 400
        try:
            text = fetch_doc_text_via_mcp_bridge(doc_id)
        except RuntimeError as e:
            return jsonify(error=str(e)), 502

    if not text:
        return jsonify(error='Please provide non-empty text in the JSON body as "text".'), 400
    max_input = MAX_LIVE_INPUT_CHARS if live else MAX_INPUT_CHARS
    if len(text) > max_input:
        return jsonify(error=f"Text is too long (max {max_input} characters)."), 400

    vocab_context = ""
    if "vocabulary" in focus_list:
        vocab_context = vocabulary_context_for_prompt()

    system = build_system_prompt(focus_list, vocab_context, live_mode=live)
    max_tokens = MAX_LIVE_OUTPUT_TOKENS if live else MAX_OUTPUT_TOKENS

    try:
        client = Groq()
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            max_tokens=max_tokens,
            temperature=0.45,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": text},
            ],
        )
    except Exception as e:  # noqa: BLE001
        return jsonify(error=f"Groq request failed: {e!s}"), 502

    raw_content = (completion.choices[0].message.content or "").strip()
    if not raw_content:
        return jsonify(error="Model returned empty content."), 502

    display_feedback, pairs = parse_vocab_json_suffix(raw_content)
    display_feedback = normalize_feedback_text(display_feedback)
    saved = 0
    if not live and "vocabulary" in focus_list and pairs:
        saved = insert_vocab_pairs(pairs)

    return jsonify(
        {
            "feedback": display_feedback,
            "model": GROQ_MODEL,
            "focus": focus_list,
            "vocabulary_pairs_saved": saved,
            "live": live,
            "source": "mcp_bridge" if use_mcp else "text",
            "doc_id": doc_id if use_mcp else "",
        }
    )


@app.get("/api/word-bank")
def word_bank():
    limit_raw = request.args.get("limit", "40")
    try:
        limit = int(limit_raw)
    except ValueError:
        limit = 40
    limit = max(1, min(limit, 200))
    words = get_word_bank(limit=limit)
    return jsonify({"items": words, "count": len(words)})


@app.get("/")
def index():
    return send_from_directory(LANDING_DIR, "index.html")


@app.get("/<path:name>")
def landing_assets(name: str):
    if name in ALLOWED_LANDING_FILES:
        return send_from_directory(LANDING_DIR, name)
    abort(404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    app.run(host="127.0.0.1", port=port, debug=True)
