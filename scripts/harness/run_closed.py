"""Sweep a closed frontier model. THIS IS THE PAID LINE - keep it to a subsample.

    export OPENROUTER_API_KEY=...
    python -m scripts.harness.run_closed --release release/v1 --model openai/gpt-6 --out runs/gpt6.jsonl

Defaults to a 3,000-item stratified cap, because per-image cost on a long-context
frontier model dominates everything else in the budget.
"""
from __future__ import annotations
from .sweep import main

if __name__ == "__main__":
    raise SystemExit(main("closed"))
