"""Isolated backend for proxy smoke checks; never calls real services."""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond()

    def do_POST(self):
        self.respond()

    def respond(self):
        if self.path == "/api/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b"data: first\n\n")
            self.wfile.flush()
            time.sleep(2)
            self.wfile.write(b"data: last\n\n")
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        status = 503 if self.path.startswith("/api/failure") else 200
        payload = json.dumps({"path": self.path, "method": self.command,
                              "body": body.decode(),
                              "user": self.headers.get("x-user-email")}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 7071), Handler).serve_forever()
