import json
import os
import sys
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .agent import Agent, DEFAULT_MODEL
from .assets import resource


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def headers_for(self, status, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()

    def send_json(self, status, data):
        self.headers_for(status, "application/json; charset=utf-8")
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def local_request(self):
        port = self.server.server_port
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        if host not in hosts or (origin and origin != f"http://{host}"):
            self.send_json(403, {"error": "Local requests only."})
            return False
        return True

    def do_GET(self):
        if not self.local_request():
            return
        assets = {
            "/": ("templates/index.html", "text/html; charset=utf-8"),
            "/static/app.js": ("static/app.js", "text/javascript; charset=utf-8"),
            "/static/style.css": ("static/style.css", "text/css; charset=utf-8"),
        }
        if self.path == "/api/config":
            self.send_json(200, {"model": self.server.default_model})
        elif self.path in assets:
            name, content_type = assets[self.path]
            body = resource("ui", *name.split("/")).read_text(encoding="utf-8")
            if self.path == "/":
                body = body.replace("$title", "Mulebot")
            self.headers_for(200, content_type)
            self.wfile.write(body.encode())
        else:
            self.send_json(404, {"error": "Not found."})

    def do_POST(self):
        if not self.local_request():
            return
        if self.path != "/api/chat":
            self.send_json(404, {"error": "Not found."})
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            self.send_json(415, {"error": "Send application/json."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 10_000_000:
                raise ValueError("Request is too large or empty.")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("Send a JSON object.")
            message = body.get("message")
            if not isinstance(message, str) or not message.strip() or len(message) > 16000:
                raise ValueError("Enter a message of at most 16,000 characters.")
            model = body.get("model", self.server.default_model)
            if not isinstance(model, str) or not model.strip() or len(model) > 200 or any(c.isspace() for c in model.strip()):
                raise ValueError("Enter an OpenRouter model ID of at most 200 characters.")
            bot = self.server.agent_factory(model=model.strip())
            bot.load_state(body.get("state"))
        except (ValueError, UnicodeError) as exc:
            self.send_json(400, {"error": str(exc)})
            return
        try:
            self.headers_for(200, "application/x-ndjson; charset=utf-8")
            with closing(bot.run(message)) as events:
                for event in events:
                    if event["type"] in {"model_start", "done"}:
                        snapshot = {"type": "state", "state": bot.export_state()}
                        self.wfile.write((json.dumps(snapshot, ensure_ascii=False) + "\n").encode())
                    self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode())
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


def create_server(port=8000, model=None, allowed_tables=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.default_model = model or os.environ.get("MULEBOT_MODEL", DEFAULT_MODEL)
    server.agent_factory = lambda **settings: Agent(allowed_tables=allowed_tables, **settings)
    return server


def serve(port=8000, model=None, allowed_tables=None):
    with create_server(port, model, allowed_tables) as server:
        print(f"Mulebot: http://localhost:{server.server_port}", file=sys.stderr, flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
