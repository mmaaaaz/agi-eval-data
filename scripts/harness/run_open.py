"""Sweep an open-weight model on your own GPU. The only cost is electricity.

Serve the model with vLLM (or any OpenAI-compatible server), then point this at it:

    vllm serve Qwen/Qwen3.8-27B --limit-mm-per-prompt image=1 --port 8000
    python -m scripts.harness.run_open --release release/v1 --model Qwen/Qwen3.8-27B --out runs/qwen.jsonl
"""
from __future__ import annotations
from .sweep import main

if __name__ == "__main__":
    raise SystemExit(main("open"))
