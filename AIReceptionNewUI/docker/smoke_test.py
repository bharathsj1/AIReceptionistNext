"""Run against Nginx configured with mock_api.py as its upstream."""
import json
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"


def request(path, data=None, headers=None):
    try:
        response = urlopen(Request(base + path, data=data, headers=headers or {}), timeout=5)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


for attempt in range(30):
    try:
        if request("/healthz")[0] == 200:
            break
    except (URLError, TimeoutError):
        pass
    time.sleep(1)
else:
    raise SystemExit("Nginx did not become healthy")

assert request("/healthz")[2] == b"ok\n"
status, headers, index = request("/")
assert status == 200 and b'id="root"' in index
assert "no-cache" in headers.get("Cache-Control", "")
for path in ("/login", "/signup", "/dashboard", "/card/abcdefghijklmnopqrstuv", "/meet/demo"):
    assert request(path)[2] == index, path
assert b"Contact" in request("/contact.html")[2]
asset = re.search(rb'src="(/assets/[^\"]+\.js)"', index).group(1).decode()
status, headers, content = request(asset)
assert status == 200 and content
assert "immutable" in headers.get("Cache-Control", "")
assert request("/assets/missing.js")[0] == 404
assert request("/media/missing.png")[0] == 404

status, headers, content = request("/api/probe?value=hello%20world")
assert status == 200 and "application/json" in headers["Content-Type"]
assert json.loads(content)["path"] == "/api/probe?value=hello%20world"
payload = b'{"message":"test"}'
status, _, content = request("/api/probe", payload,
                             {"Content-Type": "application/json", "x-user-email": "test@example.com"})
result = json.loads(content)
assert status == 200 and result["method"] == "POST"
assert result["body"] == payload.decode() and result["user"] == "test@example.com"
status, headers, _ = request("/api/failure")
assert status == 503 and "application/json" in headers["Content-Type"]
started = time.monotonic()
with urlopen(base + "/api/stream", timeout=5) as response:
    assert response.readline() == b"data: first\n"
    assert time.monotonic() - started < 1.5, "API events were buffered"
    assert b"data: last" in response.read()
print("Passed: health, SPA deep links, static pages/assets, API path/query/body/headers, API errors, streaming")
