import json
from http.server import BaseHTTPRequestHandler, HTTPServer

from google import genai

HOST = "127.0.0.1"
PORT = 8765
# Stable default; switch to e.g. gemini-3-flash-preview if you prefer.
MODEL = "gemini-2.0-flash"


class GenerateHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        if self.path != "/api/generate":
            self.send_error(404)
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/generate":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"

        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        prompt = (data.get("prompt") or "").strip()
        if not prompt:
            self._send_json(400, {"error": "Missing or empty prompt"})
            return

        try:
            client = genai.Client()
            response = client.models.generate_content(
                model=MODEL,
                contents=prompt,
            )
            text = response.text or ""
        except Exception as e:
            self._send_json(502, {"error": str(e)})
            return

        self._send_json(200, {"text": text})

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    server = HTTPServer((HOST, PORT), GenerateHandler)
    print(f"Gemini proxy listening on http://{HOST}:{PORT} (POST /api/generate)")
    print("Set GEMINI_API_KEY in the environment, then load the extension popup.")
    server.serve_forever()


if __name__ == "__main__":
    main()
