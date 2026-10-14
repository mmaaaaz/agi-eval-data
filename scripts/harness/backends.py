"""Model backends. THE ONLY PLACE THAT SPENDS MONEY.

One class covers both cases: an OpenAI-compatible chat-completions endpoint is what a
local vLLM server exposes and what every hosted provider exposes. So a sweep on your
own GPU and a sweep on a paid API differ only in the base URL and the key.

No third-party dependency is imported. That is deliberate: the spend rule says money
goes to model inference and nothing else, and a required SDK would be a new cost.
"""
from __future__ import annotations
import base64
import json
import os
import urllib.error
import urllib.request


class Backend:
    name = "base"
    is_paid = False

    def ask(self, item: dict, image_bytes: bytes, prompt: str) -> str:
        raise NotImplementedError

    def close(self) -> None:
        pass


class StubBackend(Backend):
    """Deterministic and offline. Answers from a fixture keyed by question id.

    Exists so the entire pipeline - release, fetch, prompt, run, grade, trace,
    analyse, ingest - can be exercised end to end without spending anything. It is
    also the control arm for a real sweep.
    """

    name = "stub"

    def __init__(self, answers: dict | None = None, default: str = "UNKNOWN"):
        self.answers = {str(k): v for k, v in (answers or {}).items()}
        self.default = default
        self.calls = 0

    def ask(self, item: dict, image_bytes: bytes, prompt: str) -> str:
        self.calls += 1
        return self.answers.get(str(item["id"]), self.default)


class OpenAICompatBackend(Backend):
    """Any OpenAI-compatible /chat/completions endpoint.

    local vLLM:  base_url=http://localhost:8000/v1        is_paid=False
    OpenRouter:  base_url=https://openrouter.ai/api/v1    is_paid=True
    """

    def __init__(
        self,
        model: str,
        base_url: str,
        api_key: str = "",
        max_tokens: int = 512,
        temperature: float = 0.0,
        timeout: int = 120,
        is_paid: bool = False,
        include_image: bool = True,
        extra_headers: dict | None = None,
    ):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.timeout = timeout
        self.is_paid = is_paid
        # False turns this into a TEXT-ONLY model: the prompt is sent, the image is
        # not. That is the blind filter, and it is how an item that is answerable
        # from language priors alone is detected.
        self.include_image = include_image
        self.extra_headers = extra_headers or {}
        self.name = "openai-compat:" + self.base_url

    def ask(self, item: dict, image_bytes: bytes, prompt: str) -> str:
        content: list[dict] = [{"type": "text", "text": prompt}]
        if self.include_image:
            b64 = base64.b64encode(image_bytes).decode("ascii")
            content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + b64}})
        body = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "messages": [
                {
                    "role": "user",
                    "content": content,
                }
            ],
        }
        data = json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        headers.update(self.extra_headers)
        req = urllib.request.Request(self.base_url + "/chat/completions", data=data, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise RuntimeError("HTTP " + str(e.code) + ": " + e.read().decode("utf-8", "replace")[:200]) from None
        choices = payload.get("choices") or []
        if not choices:
            raise RuntimeError("no choices in response: " + json.dumps(payload)[:200])
        content = choices[0].get("message", {}).get("content", "")
        if isinstance(content, list):
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        return str(content)


def from_env(kind: str, model: str, limit_key: str = "") -> tuple[Backend, int | None]:
    """Build a backend for a sweep. Returns (backend, default_limit).

    kind='open'   -> a local vLLM/OpenAI-compatible server (your own GPU, no cash)
    kind='closed' -> OpenRouter, key from OPENROUTER_API_KEY (the paid line)
    """
    if kind == "open":
        base_url = os.environ.get("VLLM_BASE_URL", "http://localhost:8000/v1")
        return OpenAICompatBackend(model=model, base_url=base_url, is_paid=False), None
    if kind == "closed":
        key = os.environ.get("OPENROUTER_API_KEY", "")
        if not key:
            raise SystemExit("OPENROUTER_API_KEY is not set. This is the one paid dependency; export it first.")
        url = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        return OpenAICompatBackend(
            model=model, base_url=url, api_key=key, is_paid=True,
            extra_headers={"HTTP-Referer": "https://agi-eval-data.pages.dev", "X-Title": "seen-not-grasped"},
        ), 3000
    raise SystemExit("unknown backend kind: " + kind)
