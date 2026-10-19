#!/usr/bin/env python
"""Local read/demo proxy for the relay when this network drops a Cloudflare edge.

    python -m scripts.harness.local_relay_proxy --port 8787

The relay's hostname resolves to the 188.114.x Cloudflare range, which this
network blackholes; other Cloudflare edges serve the same Worker. This proxy
accepts plain-HTTP requests on localhost, forwards them over TLS to a pinned
edge IP while keeping the real Host/SNI, and answers with CORS headers so the
local dev server (or a demo browser) can talk to it.

It is a DEMO/DEV tool: it holds no credentials, forwards whatever reviewer or
harness header the caller sends, and listens on loopback only. The review room
still needs the reviewer code to approve anything.
"""

from __future__ import annotations

import argparse
import http.server
import json
import ssl
import socket
import urllib.error
import urllib.request
from urllib.parse import urlparse

DEFAULT_HOST = "agi-eval-relay.devmaaaaz.workers.dev"
DEFAULT_IP = "104.18.12.15"


class Handler(http.server.BaseHTTPRequestHandler):
    host = DEFAULT_HOST
    ip = DEFAULT_IP

    def log_message(self, fmt: str, *args: object) -> None:  # quieter
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def _proxy(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {
            "Host": self.host,
            # Cloudflare in front of the Worker rejects non-browser user agents
            # (1010), so a Python client going through this proxy still needs a
            # browser UA on the upstream hop.
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                           "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"),
            "Accept": self.headers.get("Accept", "application/json"),
        }
        for h in ("Content-Type", "x-questions-code", "x-harness-code", "x-actor", "x-actor-name"):
            v = self.headers.get(h)
            if v:
                headers[h] = v

        url = f"https://{self.ip}{self.path}"
        req = urllib.request.Request(url, data=body, headers=headers, method=self.command)

        # Pin the TLS SNI + certificate check to the real hostname while the TCP
        # connection goes to the reachable edge IP.
        ctx = ssl.create_default_context()
        sock = socket.create_connection((self.ip, 443), timeout=60)
        wrapped = ctx.wrap_socket(sock, server_hostname=self.host)
        try:
            raw = (
                f"{self.command} {self.path} HTTP/1.1\r\n"
                + "".join(f"{k}: {v}\r\n" for k, v in headers.items())
                + (f"Content-Length: {len(body)}\r\n" if body else "Content-Length: 0\r\n")
                + "Connection: close\r\n\r\n"
            ).encode() + (body or b"")
            wrapped.sendall(raw)
            data = b""
            while True:
                chunk = wrapped.recv(65536)
                if not chunk:
                    break
                data += chunk
            head, _, payload = data.partition(b"\r\n\r\n")
            status_line = head.split(b"\r\n", 1)[0].decode(errors="replace")
            status = int(status_line.split()[1]) if len(status_line.split()) > 1 else 502
            self.send_response(status)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "content-type,x-questions-code,x-harness-code,x-actor,x-actor-name")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        finally:
            wrapped.close()

    def do_GET(self) -> None:
        if self.path.startswith("/health"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"proxy":true}')
            return
        if self.path.startswith("/img/"):
            # Demo-only image proxy: the browser on this network picks a
            # blackholed IPv4 route to the CDN, while this process reaches it
            # over IPv6. Same bytes, served from loopback.
            from urllib.parse import parse_qs, urlparse

            parsed = urlparse(self.path)
            fid = parsed.path[len("/img/"):]
            width = parse_qs(parsed.query).get("w", ["400"])[0]
            try:
                with urllib.request.urlopen(
                    f"https://lh3.googleusercontent.com/d/{fid}=w{width}", timeout=30,
                ) as r:
                    data = r.read()
                    ctype = r.headers.get("content-type", "image/jpeg")
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", ctype)
                self.send_header("Cache-Control", "public, max-age=3600")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)[:120]}).encode())
            return
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()

    def do_DELETE(self) -> None:
        self._proxy()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type,x-questions-code,x-harness-code,x-actor,x-actor-name")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default=DEFAULT_HOST)
    ap.add_argument("--ip", default=DEFAULT_IP)
    args = ap.parse_args()
    Handler.host = args.host
    Handler.ip = args.ip
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"local relay proxy on http://127.0.0.1:{args.port} -> https://{args.host} via {args.ip}", flush=True)
    srv.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
