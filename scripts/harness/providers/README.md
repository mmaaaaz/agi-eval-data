# Provider lanes — paste keys here

One file per lane. Each is gitignored; nothing in this directory is committed.

```
scripts/harness/providers/lane2.env
```

with exactly these three lines:

```
VQA_API_KEY=<the key>
VQA_API_BASE=<the gateway base URL, ending before /chat/completions>
VQA_MODEL=minimax/minimax-m3.1-flash:free
```

Then a lane is one command (run it in its own terminal or background job):

```
python -m scripts.harness.drive_generation \
  --batch full-50k-lane2 --images runs/generation/full-50k/shard-2.jsonl \
  --env-file scripts/harness/providers/lane2.env --endpoint lane2 \
  --concurrency 64 --rpm 900 --hours 8
```

Steps to add a lane safely:

1. `python -m scripts.harness.shard_images --batch full-50k --lanes 2`
   (skips every image already parsed in the main batch, deals the rest round-robin)
2. paste the key into `providers/lane2.env`
3. run the driver command above against `shard-2.jsonl`
4. when the lanes finish: `python -m scripts.harness.merge_batches --out-batch full-50k --batches full-50k,full-50k-lane2`

Rules that keep the data honest:

- **Same model id on every lane** (`minimax/minimax-m3.1-flash:free`) so the
  dataset is one model's output, not a blend.
- Even the same model is not bit-identical across gateways (different serving,
  sometimes different quantisation, and temperature 0 is not a determinism
  guarantee). Every row records its `endpoint`, so this is traceable; do not
  claim provider-invariance anywhere.
- A lane writes only its own `runs/generation/<batch>/candidates.jsonl`; merging
  is a separate read.
