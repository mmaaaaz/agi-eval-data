#!/usr/bin/env python3
"""
netfix.py — network resilience patch for this machine (2026-09-05 diagnosis):

The local network path (WARP/middlebox) intermittently kills TLS ≤1.2
handshakes to googleapis.com (ssl.SSLEOFError), while pure TLS 1.3 works.
Python's default context negotiates 1.2-compatible handshakes → breaks.

Import this module BEFORE building any Drive service; it monkeypatches
ssl.create_default_context to require TLS 1.3. Harmless on GitHub runners
(googleapis.com supports TLS 1.3 everywhere).
"""
import ssl

_patched = False


def apply():
    global _patched
    if _patched:
        return
    _orig = ssl.create_default_context

    def tls13_only(*args, **kwargs):
        ctx = _orig(*args, **kwargs)
        try:
            ctx.minimum_version = ssl.TLSVersion.TLSv1_3
        except Exception:  # noqa: BLE001
            pass
        return ctx

    ssl.create_default_context = tls13_only
    # urllib derives its default from this attribute, not the function:
    try:
        ssl._create_default_https_context = tls13_only
    except Exception:  # noqa: BLE001
        pass
    _patched = True
