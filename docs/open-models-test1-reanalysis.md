# Test-1 reanalysis: the six open-weight runs

Computed 2026-09-21T22:18:48+00:00 from the stored response files only - no API calls, no re-runs, no new model
evaluations. Engine `scripts/open_models_test1_reanalysis.py`; artifact
`data/open-models/reanalysis.json`; this document is rendered from that artifact by
`scripts/open_models_test1_report.py`, so no figure here is typed by hand.

## Summary

| model | n used | baseline | raw (exact) | raw (published) | adjusted MACRO | MACRO 95% CI | adjusted POOLED |
|---|---|---|---|---|---|---|---|
| Qwen3-VL-8B-Instruct | 243,500 | 0.302 | 0.407 | 0.427 | **+0.1441** | [+0.1413, +0.1468] | +0.1507 |
| Pixtral Large 2411 (FP8) | 239,622 | 0.303 | 0.378 | 0.400 | **+0.1085** | [+0.1057, +0.1115] | +0.1084 |
| Molmo2-8B | 243,500 | 0.302 | 0.382 | 0.400 | **+0.1060** | [+0.1032, +0.1087] | +0.1150 |
| Qwen3-VL-8B-Thinking | 243,500 | 0.302 | 0.388 | 0.407 | **+0.1021** | [+0.0992, +0.1048] | +0.1240 |
| InternVL3.5-8B | 243,505 | 0.302 | 0.346 | 0.369 | **+0.0458** | [+0.0431, +0.0486] | +0.0634 |
| Kimi-VL-A3B-Thinking | 243,500 | 0.302 | 0.305 | 0.318 | **-0.0249** | [-0.0277, -0.0221] | +0.0044 |
| DeepSeek-VL2-Small | 243,505 | 0.302 | 0.288 | 0.296 | **-0.0506** | [-0.0534, -0.0478] | -0.0189 |

Two of the six runs sit **below the constant-answer baseline on average** (Kimi-VL-A3B-Thinking, DeepSeek-VL2-Small): across the 34 x 5 cells, answering the most common ground truth would have scored higher than the model did.

## 1. L5 check

| model | L1 | L2 | L3 | L4 | L5 | total | verdict |
|---|---|---|---|---|---|---|---|
| Qwen3-VL-8B-Instruct | 50,500 | 50,500 | 50,500 | 50,500 | 50,500 | 252,500 | (a) L5 present |
| Pixtral Large 2411 (FP8) | 49,725 | 49,724 | 49,725 | 49,724 | 49,724 | 248,622 | (a) L5 present |
| Molmo2-8B | 50,500 | 50,500 | 50,500 | 50,500 | 50,500 | 252,500 | (a) L5 present |
| Qwen3-VL-8B-Thinking | 50,500 | 50,500 | 50,500 | 50,500 | 50,500 | 252,500 | (a) L5 present |
| InternVL3.5-8B | 50,501 | 50,501 | 50,501 | 50,501 | 50,501 | 252,505 | (a) L5 present |
| Kimi-VL-A3B-Thinking | 50,500 | 50,500 | 50,500 | 50,500 | 50,500 | 252,500 | (a) L5 present |
| DeepSeek-VL2-Small | 50,501 | 50,501 | 50,501 | 50,501 | 50,501 | 252,505 | (a) L5 present |

**Case (a) for all six models.** L5 responses exist, are stored for every domain, and are already scored - the published report on the site covers **L1-L5**, not L1-L4. The premise that L5 was not reported does not match this tier's stored data or its published pages, so nothing had to be recovered: the L5 rows below are the same records the site already scores. No level is blank in any table in this document.

Invariant checked while counting: every cell holds exactly one question per image per level (1190 cells, 0 violations).

## 2. Constant-answer baselines on this sample

baseline[domain][level] = max over distinct ground-truth values v of count(gt == v) / n - computed from recorded ground truth only, over exactly the items each model was evaluated on. Ground truth is identical across runs for identical question ids, so one table serves all six models; the two runs with a 1,501-image angle_estimation cell are noted in Appendix C.

- cells: 170 per model (34 domains x 5 levels), 6 of them structurally constant
- baseline range across the 170 cells: 0.001 to 1.000
- baseline for exact-match accuracy: the published comparison function with the numeric tolerance set to zero; the published 1% / 0.05 tolerance is reported alongside in every table, never replaced

The previously published 13.76% figure is a single pooled majority-answer share, not this quantity, and it is not used anywhere below. A per-(domain, level) table of n, baseline and modal ground truth is Appendix A.

## 3. The transform

`adjusted = (accuracy - baseline) / (1 - baseline)`. **MACRO** is the unweighted mean of per-cell adjusted scores over non-constant cells; **POOLED** sums correct and baseline-expected counts over non-constant cells and transforms once.

| model | cells used | n | baseline | raw (exact) | raw (published) | adj. MACRO | MACRO 95% CI | adj. POOLED | POOLED 95% CI |
|---|---|---|---|---|---|---|---|---|---|
| Qwen3-VL-8B-Instruct | 164/170 | 243,500 | 0.302 | 0.407 | 0.427 | **+0.1441** | [+0.1413, +0.1468] | +0.1507 | [+0.1484, +0.1531] |
| Pixtral Large 2411 (FP8) | 164/170 | 239,622 | 0.303 | 0.378 | 0.400 | **+0.1085** | [+0.1057, +0.1115] | +0.1084 | [+0.1061, +0.1107] |
| Molmo2-8B | 164/170 | 243,500 | 0.302 | 0.382 | 0.400 | **+0.1060** | [+0.1032, +0.1087] | +0.1150 | [+0.1127, +0.1173] |
| Qwen3-VL-8B-Thinking | 164/170 | 243,500 | 0.302 | 0.388 | 0.407 | **+0.1021** | [+0.0992, +0.1048] | +0.1240 | [+0.1216, +0.1263] |
| InternVL3.5-8B | 164/170 | 243,505 | 0.302 | 0.346 | 0.369 | **+0.0458** | [+0.0431, +0.0486] | +0.0634 | [+0.0612, +0.0657] |
| Kimi-VL-A3B-Thinking | 164/170 | 243,500 | 0.302 | 0.305 | 0.318 | **-0.0249** | [-0.0277, -0.0221] | +0.0044 | [+0.0022, +0.0066] |
| DeepSeek-VL2-Small | 164/170 | 243,505 | 0.302 | 0.288 | 0.296 | **-0.0506** | [-0.0534, -0.0478] | -0.0189 | [-0.0212, -0.0167] |

The two aggregations disagree on rank order once: Molmo2-8B has the higher MACRO (+0.1060) while Qwen3-VL-8B-Thinking has the higher POOLED (+0.1240), because Thinking does relatively better on the large domains and relatively worse on the small ones.

Structurally constant cells (baseline = 1.0, undefined, excluded from every aggregate rather than substituted with 0 or NaN-as-zero):

| domain | level | the only ground truth | n per model |
|---|---|---|---|
| cube_net | L1 | `6` | 1,500 |
| gear_train | L2 | `opposite` | 1,500 |
| optical_illusion | L1 | `2` | 1,500 |
| orthographic | L5 | `front and side` | 1,500 |
| polyhedron | L5 | `no` | 1,500 |
| symmetry_pattern | L5 | `yes` | 1,500 |

Cells with n < 10: **0** across all six models. There are none, so the primary aggregates and the supplementary aggregates without small cells are identical; the column exists in `reanalysis.json` regardless.

Negative adjusted scores are reported as computed and never clipped: Qwen-I +0.1441, Pixtral +0.1085, Molmo2 +0.1060, Qwen-T +0.1021, InternVL +0.0458, Kimi -0.0249, DeepSeek -0.0506 (MACRO).

## 4. Tier-comparison subset (8,500 rows)

**Status: blocked.**

- Reason: no frontier manifest on disk: the 8,500-row id list this section joins on does not exist in the repository or the project tree. Searched for *frontier*, *manifest*, *8500* by name (project tree and D: to depth 4) and for 'frontier' by content, and inspected the only candidate directories.
- Missing input: a file with the 8,500 question ids the frontier tier was evaluated on (json / jsonl / csv with a question_id column) — pass it with --manifest
- Ready: the whole subset pipeline is implemented: with --manifest it re-runs baselines on the subset, joins per model, reports coverage and missing rows, and emits the subset tables and CIs
- Not produced: any first-tier number, including the combined 16-model table. the frontier tier's own results are not on disk either, so the 16-model combined table and the '16 of 16 below baseline' check cannot be reproduced or verified locally

## 5. Tables the open-weight tier was missing

### 5.1 Per level (L1-L5)

| model | level | n | baseline | raw (exact) | adjusted | adj. MACRO | MACRO CI |
|---|---|---|---|---|---|---|---|
| Qwen-I | L1 | 47,500 | 0.285 | 0.539 | +0.3560 | +0.3968 | [+0.3924, +0.4012] |
| Qwen-I | L2 | 49,000 | 0.401 | 0.500 | +0.1651 | +0.1662 | [+0.1593, +0.1730] |
| Qwen-I | L3 | 50,500 | 0.233 | 0.388 | +0.2018 | +0.2011 | [+0.1958, +0.2062] |
| Qwen-I | L4 | 50,500 | 0.235 | 0.282 | +0.0616 | +0.0412 | [+0.0363, +0.0461] |
| Qwen-I | L5 | 46,000 | 0.362 | 0.329 | -0.0514 | -0.0902 | [-0.0980, -0.0825] |
| Pixtral | L1 | 46,725 | 0.287 | 0.517 | +0.3221 | +0.3669 | [+0.3632, +0.3716] |
| Pixtral | L2 | 48,224 | 0.403 | 0.496 | +0.1555 | +0.1810 | [+0.1739, +0.1882] |
| Pixtral | L3 | 49,725 | 0.231 | 0.333 | +0.1317 | +0.1331 | [+0.1273, +0.1381] |
| Pixtral | L4 | 49,724 | 0.236 | 0.247 | +0.0148 | -0.0056 | [-0.0105, -0.0003] |
| Pixtral | L5 | 45,224 | 0.363 | 0.303 | -0.0932 | -0.1370 | [-0.1448, -0.1293] |
| Molmo2 | L1 | 47,500 | 0.285 | 0.555 | +0.3779 | +0.4170 | [+0.4130, +0.4210] |
| Molmo2 | L2 | 49,000 | 0.401 | 0.497 | +0.1601 | +0.1732 | [+0.1657, +0.1807] |
| Molmo2 | L3 | 50,500 | 0.233 | 0.334 | +0.1319 | +0.1195 | [+0.1143, +0.1247] |
| Molmo2 | L4 | 50,500 | 0.235 | 0.236 | +0.0019 | -0.0152 | [-0.0203, -0.0102] |
| Molmo2 | L5 | 46,000 | 0.362 | 0.293 | -0.1079 | -0.1687 | [-0.1765, -0.1609] |
| Qwen-T | L1 | 47,500 | 0.285 | 0.558 | +0.3815 | +0.4221 | [+0.4178, +0.4264] |
| Qwen-T | L2 | 49,000 | 0.401 | 0.497 | +0.1608 | +0.1585 | [+0.1514, +0.1653] |
| Qwen-T | L3 | 50,500 | 0.233 | 0.376 | +0.1861 | +0.1812 | [+0.1760, +0.1867] |
| Qwen-T | L4 | 50,500 | 0.235 | 0.255 | +0.0258 | -0.0093 | [-0.0141, -0.0046] |
| Qwen-T | L5 | 46,000 | 0.362 | 0.258 | -0.1638 | -0.2528 | [-0.2599, -0.2459] |
| InternVL | L1 | 47,501 | 0.285 | 0.492 | +0.2893 | +0.3257 | [+0.3207, +0.3307] |
| InternVL | L2 | 49,001 | 0.401 | 0.472 | +0.1190 | +0.1401 | [+0.1333, +0.1470] |
| InternVL | L3 | 50,501 | 0.233 | 0.325 | +0.1194 | +0.1103 | [+0.1051, +0.1155] |
| InternVL | L4 | 50,501 | 0.235 | 0.197 | -0.0490 | -0.0762 | [-0.0809, -0.0715] |
| InternVL | L5 | 46,001 | 0.362 | 0.248 | -0.1794 | -0.2802 | [-0.2877, -0.2728] |
| Kimi | L1 | 47,500 | 0.285 | 0.372 | +0.1224 | +0.1315 | [+0.1256, +0.1374] |
| Kimi | L2 | 49,000 | 0.401 | 0.441 | +0.0669 | +0.0842 | [+0.0768, +0.0917] |
| Kimi | L3 | 50,500 | 0.233 | 0.285 | +0.0681 | +0.0510 | [+0.0457, +0.0562] |
| Kimi | L4 | 50,500 | 0.235 | 0.189 | -0.0601 | -0.0951 | [-0.0995, -0.0905] |
| Kimi | L5 | 46,000 | 0.362 | 0.239 | -0.1936 | -0.3088 | [-0.3166, -0.3010] |
| DeepSeek | L1 | 47,501 | 0.285 | 0.358 | +0.1029 | +0.1147 | [+0.1092, +0.1203] |
| DeepSeek | L2 | 49,001 | 0.401 | 0.443 | +0.0698 | +0.0694 | [+0.0610, +0.0776] |
| DeepSeek | L3 | 50,501 | 0.233 | 0.273 | +0.0515 | +0.0252 | [+0.0202, +0.0301] |
| DeepSeek | L4 | 50,501 | 0.235 | 0.175 | -0.0782 | -0.1038 | [-0.1082, -0.0994] |
| DeepSeek | L5 | 46,001 | 0.362 | 0.194 | -0.2636 | -0.3736 | [-0.3808, -0.3665] |

**L5 is negative for all six models** once the constant answer is accounted for: Qwen-I -0.0902, Pixtral -0.1370, Molmo2 -0.1687, Qwen-T -0.2528, InternVL -0.2802, Kimi -0.3088, DeepSeek -0.3736. L1 is where every run gains most.

### 5.2 Per family (9 families)

| model | family | n | baseline | raw (exact) | adjusted | adj. MACRO | MACRO CI |
|---|---|---|---|---|---|---|---|
| Qwen-I | Analytic | 15,000 | 0.167 | 0.429 | +0.3146 | +0.3823 | [+0.3744, +0.3901] |
| Qwen-I | Inductive | 7,500 | 0.364 | 0.560 | +0.3082 | +0.1973 | [+0.1776, +0.2173] |
| Qwen-I | Optical | 13,500 | 0.443 | 0.264 | -0.3216 | -0.3487 | [-0.3628, -0.3342] |
| Qwen-I | Physical & Mechanical | 48,500 | 0.289 | 0.413 | +0.1744 | +0.1547 | [+0.1491, +0.1603] |
| Qwen-I | Plane Geometry | 37,500 | 0.278 | 0.360 | +0.1130 | +0.1081 | [+0.1002, +0.1160] |
| Qwen-I | Projective | 15,000 | 0.315 | 0.495 | +0.2633 | +0.2868 | [+0.2766, +0.2967] |
| Qwen-I | Solid Geometry | 40,500 | 0.301 | 0.465 | +0.2340 | +0.2527 | [+0.2454, +0.2602] |
| Qwen-I | Topological | 22,500 | 0.328 | 0.374 | +0.0690 | +0.0940 | [+0.0847, +0.1033] |
| Qwen-I | Transformational | 43,500 | 0.310 | 0.384 | +0.1068 | +0.0997 | [+0.0931, +0.1063] |
| Pixtral | Analytic | 15,000 | 0.167 | 0.241 | +0.0892 | +0.1459 | [+0.1409, +0.1509] |
| Pixtral | Inductive | 7,500 | 0.364 | 0.532 | +0.2634 | +0.1507 | [+0.1306, +0.1709] |
| Pixtral | Optical | 13,500 | 0.443 | 0.283 | -0.2871 | -0.3097 | [-0.3234, -0.2959] |
| Pixtral | Physical & Mechanical | 48,500 | 0.289 | 0.415 | +0.1771 | +0.1806 | [+0.1745, +0.1865] |
| Pixtral | Plane Geometry | 37,500 | 0.278 | 0.311 | +0.0447 | +0.0473 | [+0.0402, +0.0545] |
| Pixtral | Projective | 15,000 | 0.315 | 0.465 | +0.2196 | +0.2460 | [+0.2353, +0.2569] |
| Pixtral | Solid Geometry | 36,622 | 0.307 | 0.444 | +0.1988 | +0.1891 | [+0.1819, +0.1978] |
| Pixtral | Topological | 22,500 | 0.328 | 0.385 | +0.0855 | +0.1231 | [+0.1144, +0.1317] |
| Pixtral | Transformational | 43,500 | 0.310 | 0.356 | +0.0663 | +0.0565 | [+0.0501, +0.0627] |
| Molmo2 | Analytic | 15,000 | 0.167 | 0.325 | +0.1904 | +0.2566 | [+0.2494, +0.2639] |
| Molmo2 | Inductive | 7,500 | 0.364 | 0.364 | -0.0008 | -0.1404 | [-0.1552, -0.1254] |
| Molmo2 | Optical | 13,500 | 0.443 | 0.262 | -0.3257 | -0.3525 | [-0.3666, -0.3384] |
| Molmo2 | Physical & Mechanical | 48,500 | 0.289 | 0.454 | +0.2320 | +0.2129 | [+0.2069, +0.2190] |
| Molmo2 | Plane Geometry | 37,500 | 0.278 | 0.320 | +0.0583 | +0.0501 | [+0.0427, +0.0576] |
| Molmo2 | Projective | 15,000 | 0.315 | 0.441 | +0.1838 | +0.1861 | [+0.1759, +0.1962] |
| Molmo2 | Solid Geometry | 40,500 | 0.301 | 0.402 | +0.1439 | +0.1401 | [+0.1329, +0.1474] |
| Molmo2 | Topological | 22,500 | 0.328 | 0.310 | -0.0258 | -0.0247 | [-0.0346, -0.0150] |
| Molmo2 | Transformational | 43,500 | 0.310 | 0.413 | +0.1492 | +0.1696 | [+0.1633, +0.1756] |
| Qwen-T | Analytic | 15,000 | 0.167 | 0.317 | +0.1796 | +0.2352 | [+0.2289, +0.2416] |
| Qwen-T | Inductive | 7,500 | 0.364 | 0.615 | +0.3940 | +0.3170 | [+0.2941, +0.3393] |
| Qwen-T | Optical | 13,500 | 0.443 | 0.198 | -0.4397 | -0.4743 | [-0.4857, -0.4630] |
| Qwen-T | Physical & Mechanical | 48,500 | 0.289 | 0.499 | +0.2954 | +0.2650 | [+0.2589, +0.2711] |
| Qwen-T | Plane Geometry | 37,500 | 0.278 | 0.293 | +0.0207 | -0.0150 | [-0.0219, -0.0082] |
| Qwen-T | Projective | 15,000 | 0.315 | 0.536 | +0.3233 | +0.3505 | [+0.3396, +0.3614] |
| Qwen-T | Solid Geometry | 40,500 | 0.301 | 0.388 | +0.1235 | +0.0774 | [+0.0697, +0.0847] |
| Qwen-T | Topological | 22,500 | 0.328 | 0.329 | +0.0019 | +0.0149 | [+0.0053, +0.0242] |
| Qwen-T | Transformational | 43,500 | 0.310 | 0.372 | +0.0887 | +0.0905 | [+0.0842, +0.0969] |
| InternVL | Analytic | 15,000 | 0.167 | 0.259 | +0.1101 | +0.1682 | [+0.1628, +0.1735] |
| InternVL | Inductive | 7,500 | 0.364 | 0.349 | -0.0245 | -0.1659 | [-0.1828, -0.1489] |
| InternVL | Optical | 13,500 | 0.443 | 0.223 | -0.3950 | -0.4257 | [-0.4371, -0.4144] |
| InternVL | Physical & Mechanical | 48,500 | 0.289 | 0.421 | +0.1852 | +0.1806 | [+0.1742, +0.1870] |
| InternVL | Plane Geometry | 37,505 | 0.278 | 0.314 | +0.0494 | +0.0441 | [+0.0366, +0.0514] |
| InternVL | Projective | 15,000 | 0.315 | 0.368 | +0.0779 | +0.0852 | [+0.0752, +0.0953] |
| InternVL | Solid Geometry | 40,500 | 0.301 | 0.424 | +0.1751 | +0.1736 | [+0.1659, +0.1810] |
| InternVL | Topological | 22,500 | 0.328 | 0.287 | -0.0601 | -0.0482 | [-0.0583, -0.0382] |
| InternVL | Transformational | 43,500 | 0.310 | 0.309 | -0.0025 | -0.0538 | [-0.0597, -0.0478] |
| Kimi | Analytic | 15,000 | 0.167 | 0.163 | -0.0045 | -0.0155 | [-0.0239, -0.0072] |
| Kimi | Inductive | 7,500 | 0.364 | 0.292 | -0.1137 | -0.2277 | [-0.2468, -0.2083] |
| Kimi | Optical | 13,500 | 0.443 | 0.234 | -0.3749 | -0.4055 | [-0.4175, -0.3934] |
| Kimi | Physical & Mechanical | 48,500 | 0.289 | 0.344 | +0.0780 | +0.0284 | [+0.0217, +0.0351] |
| Kimi | Plane Geometry | 37,500 | 0.278 | 0.272 | -0.0082 | -0.0162 | [-0.0230, -0.0094] |
| Kimi | Projective | 15,000 | 0.315 | 0.398 | +0.1213 | +0.1451 | [+0.1345, +0.1556] |
| Kimi | Solid Geometry | 40,500 | 0.301 | 0.345 | +0.0626 | +0.0308 | [+0.0231, +0.0384] |
| Kimi | Topological | 22,500 | 0.328 | 0.284 | -0.0659 | -0.0504 | [-0.0587, -0.0421] |
| Kimi | Transformational | 43,500 | 0.310 | 0.303 | -0.0107 | -0.0423 | [-0.0489, -0.0355] |
| DeepSeek | Analytic | 15,000 | 0.167 | 0.201 | +0.0408 | +0.0657 | [+0.0583, +0.0731] |
| DeepSeek | Inductive | 7,500 | 0.364 | 0.246 | -0.1856 | -0.3465 | [-0.3615, -0.3311] |
| DeepSeek | Optical | 13,500 | 0.443 | 0.291 | -0.2721 | -0.2870 | [-0.3004, -0.2738] |
| DeepSeek | Physical & Mechanical | 48,500 | 0.289 | 0.283 | -0.0091 | -0.0493 | [-0.0561, -0.0427] |
| DeepSeek | Plane Geometry | 37,505 | 0.278 | 0.294 | +0.0221 | +0.0071 | [-0.0002, +0.0144] |
| DeepSeek | Projective | 15,000 | 0.315 | 0.282 | -0.0476 | -0.0759 | [-0.0862, -0.0656] |
| DeepSeek | Solid Geometry | 40,500 | 0.301 | 0.337 | +0.0506 | +0.0482 | [+0.0402, +0.0561] |
| DeepSeek | Topological | 22,500 | 0.328 | 0.271 | -0.0844 | -0.0898 | [-0.0988, -0.0811] |
| DeepSeek | Transformational | 43,500 | 0.310 | 0.293 | -0.0248 | -0.0804 | [-0.0866, -0.0742] |

### 5.3 Per domain (34 domains)

The full 204-row table is Appendix B. Extremes per run:

| model | best domain | adjusted | worst domain | adjusted |
|---|---|---|---|---|
| Qwen-I | projectile_motion | +0.6612 | physical_stability | -0.6088 |
| Pixtral | projectile_motion | +0.5686 | impossible_object | -0.3582 |
| Molmo2 | depth_height | +0.4621 | impossible_object | -0.3372 |
| Qwen-T | projectile_motion | +0.8103 | optical_illusion | -0.4740 |
| InternVL | projectile_motion | +0.6294 | optical_illusion | -0.4364 |
| Kimi | depth_height | +0.4088 | optical_illusion | -0.4690 |
| DeepSeek | orthographic | +0.2552 | optical_illusion | -0.3594 |

### 5.4 Bootstrap 95% CIs on adjusted MACRO

image-level resampling, 10000 resamples, one shared draw per replicate across levels and models, baselines held fixed. Resampling is at the **image** level, not the row level: the five levels of one image are not independent. One draw is shared by all five levels and by all six models, so the intervals here and the paired differences in 6b come from the same replicates.

| model | adjusted MACRO | 95% CI | width |
|---|---|---|---|
| Qwen3-VL-8B-Instruct | +0.1441 | [+0.1413, +0.1468] | 0.0056 |
| Pixtral Large 2411 (FP8) | +0.1085 | [+0.1057, +0.1115] | 0.0057 |
| Molmo2-8B | +0.1060 | [+0.1032, +0.1087] | 0.0056 |
| Qwen3-VL-8B-Thinking | +0.1021 | [+0.0992, +0.1048] | 0.0056 |
| InternVL3.5-8B | +0.0458 | [+0.0431, +0.0486] | 0.0055 |
| Kimi-VL-A3B-Thinking | -0.0249 | [-0.0277, -0.0221] | 0.0056 |
| DeepSeek-VL2-Small | -0.0506 | [-0.0534, -0.0478] | 0.0056 |

## 6. Cross-checks

### 6a. impossible_object

| model | n | baseline | raw (exact) | adjusted | vs baseline |
|---|---|---|---|---|---|
| Qwen3-VL-8B-Instruct | 7,500 | 0.398 | 0.209 | -0.3133 | below |
| Pixtral Large 2411 (FP8) | 7,500 | 0.398 | 0.182 | -0.3582 | below |
| Molmo2-8B | 7,500 | 0.398 | 0.195 | -0.3372 | below |
| Qwen3-VL-8B-Thinking | 7,500 | 0.398 | 0.147 | -0.4169 | below |
| InternVL3.5-8B | 7,500 | 0.398 | 0.176 | -0.3675 | below |
| Kimi-VL-A3B-Thinking | 7,500 | 0.398 | 0.210 | -0.3124 | below |
| DeepSeek-VL2-Small | 7,500 | 0.398 | 0.269 | -0.2141 | below |

**All 7 of 7 open-weight runs score below the constant-answer baseline on impossible_object** (baseline 0.398). The frontier tier reports the same for its models; combined that would make the domain a 16-of-16 anti-correlation between models and key. The frontier half cannot be reproduced here because first-tier results are not on disk (section 4), so this document reports the open-weight half only and claims nothing about the other tier's numbers.

### 6b. Qwen3-VL-8B-Instruct vs Qwen3-VL-8B-Thinking

Same weights, reasoning mode toggled, identical items. Paired image-level bootstrap on the difference of adjusted MACRO per family, 10,000 replicates.

| family | Instruct | Thinking | difference (I - T) | 95% CI (paired) | reading |
|---|---|---|---|---|---|
| Plane Geometry | +0.1081 | -0.0150 | +0.1231 | [+0.1159, +0.1302] | real |
| Solid Geometry | +0.2527 | +0.0774 | +0.1754 | [+0.1665, +0.1845] | real |
| Transformational | +0.0997 | +0.0905 | +0.0092 | [+0.0021, +0.0164] | real |
| Physical & Mechanical | +0.1547 | +0.2650 | -0.1103 | [-0.1161, -0.1044] | real |
| Topological | +0.0940 | +0.0149 | +0.0791 | [+0.0693, +0.0888] | real |
| Projective | +0.2868 | +0.3505 | -0.0637 | [-0.0741, -0.0534] | real |
| Analytic | +0.3823 | +0.2352 | +0.1471 | [+0.1386, +0.1554] | real |
| Optical | -0.3487 | -0.4743 | +0.1256 | [+0.1102, +0.1411] | real |
| Inductive | +0.1973 | +0.3170 | -0.1196 | [-0.1452, -0.0948] | real |

Every family gap excludes zero at this sample size, so the mode switch is not a wash - it trades geometry (Instruct ahead on Plane Geometry, Solid Geometry, Analytic, Topological) for physical and inductive reasoning (Thinking ahead on Physical & Mechanical, Inductive, Projective).

## 7. Serving configuration

Recoverable from disk, printed exactly as stored; nothing is inferred.

| model | model identifier stored in the records | records |
|---|---|---|
| Qwen3-VL-8B-Instruct | `qwen3-vl-8b-instruct` | 252,500 |
| Pixtral Large 2411 (FP8) | `pixtral-large-instruct-2411-hf-fp8-dynamic` | 248,622 |
| Molmo2-8B | `molmo2-8b` | 252,500 |
| Qwen3-VL-8B-Thinking | `qwen3-vl-8b-thinking` | 252,500 |
| InternVL3.5-8B | `internvl3_5-8b` | 252,505 |
| Kimi-VL-A3B-Thinking | `kimi-vl-a3b-thinking` | 252,500 |
| DeepSeek-VL2-Small | `deepseek-vl2-small` | 252,505 |

Harness score_mode distribution per run (a stored field, not a configuration):

| model | text_exact_or_substring | numeric | multi_part_exact | none |
|---|---|---|---|---|
| Qwen3-VL-8B-Instruct | 119,554 | 117,784 | 7,659 | 7,503 |
| Pixtral Large 2411 (FP8) | 117,644 | 122,912 | 8,066 | 0 |
| Molmo2-8B | 115,233 | 128,150 | 9,117 | 0 |
| Qwen3-VL-8B-Thinking | 145,240 | 97,603 | 9,651 | 6 |
| InternVL3.5-8B | 127,053 | 118,634 | 6,818 | 0 |
| Kimi-VL-A3B-Thinking | 205,341 | 38,997 | 8,161 | 1 |
| DeepSeek-VL2-Small | 158,564 | 84,849 | 9,092 | 0 |

**Not recoverable, and not guessed:**

- checkpoint revision or commit hash
- numeric precision (fp16 / bf16 / int8 / int4)
- inference engine and version
- decoding parameters (temperature, top_p, max_tokens, seed)
- served locally or through a hosted provider
- run date range beyond file timestamps

Each run directory holds exactly 34 .jsonl files and nothing else; all 204 files share one identical 10-field schema. No launch script, config, log or run metadata exists in the repository or the project tree (searched by filename and by content for vllm / sglang / lmdeploy / temperature / top_p / max_tokens / fp16 / bf16 / int4 / quantization).

Run directories: `data\open-model-analysis\Qwen3-VL-8B-Instruct\qwen3-vl-8b-instruct`, `data\open-model-analysis\Qwen3-VL-8B-Thinking\qwen3-vl-8b-thinking`, `data\open-model-analysis\Molmo2-8B\molmo2-8b`, `data\open-model-analysis\InternVL3_5-8B\internvl3_5-8b`, `data\open-model-analysis\Kimi-VL-A3B-Thinking\kimi-vl-a3b-thinking`, `data\open-model-analysis\deepseek-vl2-small\deepseek-vl2-small`, `data\open-model-analysis\Pixtral-Large-Instruct-2411-hf-FP8-dynamic\pixtral-large-instruct-2411-hf-fp8-dynamic`.

## 8. Deliverables

- This document: `docs/open-models-test1-reanalysis.md`
- Computed artifact: `data/open-models/reanalysis.json` (every cell, every table)
- Engine: `scripts/open_models_test1_reanalysis.py` (deterministic; `--boot`, `--seed`, `--manifest`)
- Renderer: `scripts/open_models_test1_report.py`
- Site: `/open-models/reanalysis` inside the grip-eval report

Blocked sections and exactly what unblocks them: a frontier manifest of the 8,500 question ids (`--manifest`) for section 4, and the frontier tier's own per-cell results for the combined 16-model table and the 16-of-16 check.

## Appendix A - baseline per (domain, level)

| domain | level | n | baseline | modal ground truth |
|---|---|---|---|---|
| angle_estimation | L1 | 1,500 | 0.359 | `2` |
| angle_estimation | L2 | 1,500 | 0.183 | `Angle 1` |
| angle_estimation | L3 | 1,500 | 0.291 | `greater than` |
| angle_estimation | L4 | 1,500 | 0.233 | `180` |
| angle_estimation | L5 | 1,500 | 0.295 | `exceeds 180` |
| clock_reading | L1 | 1,500 | 0.093 | `6` |
| clock_reading | L2 | 1,500 | 0.507 | `before` |
| clock_reading | L3 | 1,500 | 0.005 | `02:21` |
| clock_reading | L4 | 1,500 | 0.010 | `98` |
| clock_reading | L5 | 1,500 | 0.012 | `22` |
| combination | L1 | 1,500 | 0.212 | `9` |
| combination | L2 | 1,500 | 0.255 | `A` |
| combination | L3 | 1,500 | 0.323 | `yes` |
| combination | L4 | 1,500 | 0.267 | `B` |
| combination | L5 | 1,500 | 0.628 | `connected` |
| combination3d | L1 | 1,500 | 0.147 | `13` |
| combination3d | L2 | 1,500 | 0.257 | `A` |
| combination3d | L3 | 1,500 | 0.345 | `yes` |
| combination3d | L4 | 1,500 | 0.183 | `B` |
| combination3d | L5 | 1,500 | 0.326 | `same shape, different angle` |
| compass_bearing | L1 | 1,500 | 0.506 | `3` |
| compass_bearing | L2 | 1,500 | 0.452 | `south` |
| compass_bearing | L3 | 1,500 | 0.042 | `090` |
| compass_bearing | L4 | 1,500 | 0.011 | `26 degrees counterclockwise` |
| compass_bearing | L5 | 1,500 | 0.001 | `A; projected endpoint is closest to A (142.0 map units away; bearing difference 60.0 degrees)` |
| coordinate_geometry | L1 | 1,500 | 0.009 | `(0, -2)` |
| coordinate_geometry | L2 | 1,500 | 0.055 | `4.47` |
| coordinate_geometry | L3 | 1,500 | 0.327 | `A and B` |
| coordinate_geometry | L4 | 1,500 | 0.227 | `less than` |
| coordinate_geometry | L5 | 1,500 | 0.039 | `5.00` |
| cube_net | L1 | 1,500 | 1.000 | `6` |
| cube_net | L2 | 1,500 | 0.179 | `D` |
| cube_net | L3 | 1,500 | 0.165 | `1` |
| cube_net | L4 | 1,500 | 0.504 | `opposite` |
| cube_net | L5 | 1,500 | 0.785 | `no` |
| cube_structure | L1 | 1,500 | 0.165 | `8` |
| cube_structure | L2 | 1,500 | 0.177 | `8` |
| cube_structure | L3 | 1,500 | 0.497 | `1` |
| cube_structure | L4 | 1,500 | 0.347 | `2` |
| cube_structure | L5 | 1,500 | 0.347 | `2` |
| depth_height | L1 | 1,500 | 0.350 | `3` |
| depth_height | L2 | 1,500 | 0.205 | `magenta` |
| depth_height | L3 | 1,500 | 0.021 | `['orange', 'magenta']` |
| depth_height | L4 | 1,500 | 0.053 | `16` |
| depth_height | L5 | 1,500 | 0.354 | `smaller` |
| embedded_figures | L1 | 1,500 | 0.247 | `13` |
| embedded_figures | L2 | 1,500 | 0.258 | `3` |
| embedded_figures | L3 | 1,500 | 0.258 | `A` |
| embedded_figures | L4 | 1,500 | 0.172 | `no` |
| embedded_figures | L5 | 1,500 | 0.677 | `open` |
| fbd | L1 | 1,500 | 0.380 | `4` |
| fbd | L2 | 1,500 | 0.283 | `W` |
| fbd | L3 | 1,500 | 0.079 | `{'magnitude_ranking': [['W']], 'physical_equilibrium': 'yes', 'shown_vertical_forces_balanced': 'no'}` |
| fbd | L4 | 1,500 | 0.013 | `{'net_force_N': 0.0, 'required_friction_coefficient': 0.47}` |
| fbd | L5 | 1,500 | 0.504 | `downward (270 degrees; 0=right, 90=up)` |
| fold_punch | L1 | 1,500 | 0.501 | `3` |
| fold_punch | L2 | 1,500 | 0.501 | `8` |
| fold_punch | L3 | 1,500 | 0.261 | `B` |
| fold_punch | L4 | 1,500 | 0.309 | `exactly half` |
| fold_punch | L5 | 1,500 | 0.387 | `8` |
| gauge_reading | L1 | 1,500 | 0.799 | `0` |
| gauge_reading | L2 | 1,500 | 0.511 | `lower half` |
| gauge_reading | L3 | 1,500 | 0.057 | `10` |
| gauge_reading | L4 | 1,500 | 0.596 | `no danger zone marked` |
| gauge_reading | L5 | 1,500 | 0.036 | `no; new value 35` |
| gear_train | L1 | 1,500 | 0.386 | `4` |
| gear_train | L2 | 1,500 | 1.000 | `opposite` |
| gear_train | L3 | 1,500 | 0.271 | `A` |
| gear_train | L4 | 1,500 | 0.008 | `75.0` |
| gear_train | L5 | 1,500 | 0.343 | `decrease; direction unchanged` |
| hex_pathfinding | L1 | 1,500 | 0.118 | `8` |
| hex_pathfinding | L2 | 1,500 | 0.514 | `hole` |
| hex_pathfinding | L3 | 1,500 | 0.215 | `5` |
| hex_pathfinding | L4 | 1,500 | 0.219 | `unique` |
| hex_pathfinding | L5 | 1,500 | 0.329 | `no valid path exists` |
| impossible_object | L1 | 1,500 | 0.511 | `6` |
| impossible_object | L2 | 1,500 | 0.503 | `yes` |
| impossible_object | L3 | 1,500 | 0.204 | `B` |
| impossible_object | L4 | 1,500 | 0.269 | `9` |
| impossible_object | L5 | 1,500 | 0.503 | `already constructible` |
| laser_mirror | L1 | 1,500 | 0.265 | `2` |
| laser_mirror | L2 | 1,500 | 0.756 | `yes` |
| laser_mirror | L3 | 1,500 | 0.530 | `1` |
| laser_mirror | L4 | 1,500 | 0.048 | `left, position 1` |
| laser_mirror | L5 | 1,500 | 0.039 | `yes; exits at right, position 1` |
| line_intersection | L1 | 1,500 | 0.405 | `2` |
| line_intersection | L2 | 1,500 | 0.281 | `2` |
| line_intersection | L3 | 1,500 | 0.207 | `left` |
| line_intersection | L4 | 1,500 | 0.201 | `even` |
| line_intersection | L5 | 1,500 | 0.507 | `0` |
| nested_hexagons | L1 | 1,500 | 0.117 | `4` |
| nested_hexagons | L2 | 1,500 | 0.506 | `constant` |
| nested_hexagons | L3 | 1,500 | 0.050 | `5.9` |
| nested_hexagons | L4 | 1,500 | 0.149 | `0` |
| nested_hexagons | L5 | 1,500 | 0.501 | `yes` |
| nested_squares | L1 | 1,500 | 0.119 | `11` |
| nested_squares | L2 | 1,500 | 0.519 | `changing` |
| nested_squares | L3 | 1,500 | 0.052 | `5.1` |
| nested_squares | L4 | 1,500 | 0.150 | `0` |
| nested_squares | L5 | 1,500 | 0.502 | `no` |
| nested_triangles | L1 | 1,500 | 0.121 | `12` |
| nested_triangles | L2 | 1,500 | 0.501 | `constant` |
| nested_triangles | L3 | 1,500 | 0.052 | `5.1` |
| nested_triangles | L4 | 1,500 | 0.153 | `0` |
| nested_triangles | L5 | 1,500 | 0.505 | `no` |
| occluded_pattern | L1 | 1,500 | 0.146 | `4` |
| occluded_pattern | L2 | 1,500 | 0.165 | `15` |
| occluded_pattern | L3 | 1,500 | 0.349 | `triangle` |
| occluded_pattern | L4 | 1,500 | 0.369 | `2` |
| occluded_pattern | L5 | 1,500 | 0.165 | `16` |
| optical_illusion | L1 | 1,500 | 1.000 | `2` |
| optical_illusion | L2 | 1,500 | 0.507 | `A` |
| optical_illusion | L3 | 1,500 | 0.497 | `equal` |
| optical_illusion | L4 | 1,500 | 0.497 | `0` |
| optical_illusion | L5 | 1,500 | 0.497 | `yes; actually equal` |
| orthographic | L1 | 1,500 | 0.232 | `4` |
| orthographic | L2 | 1,500 | 0.183 | `10` |
| orthographic | L3 | 1,500 | 0.328 | `top` |
| orthographic | L4 | 1,500 | 0.461 | `unique` |
| orthographic | L5 | 1,500 | 1.000 | `front and side` |
| overlap_circles | L1 | 1,500 | 0.143 | `11` |
| overlap_circles | L2 | 1,500 | 0.366 | `no` |
| overlap_circles | L3 | 1,500 | 0.207 | `clustered` |
| overlap_circles | L4 | 1,500 | 0.209 | `0` |
| overlap_circles | L5 | 1,500 | 0.092 | `3` |
| physical_stability | L1 | 1,500 | 0.307 | `5` |
| physical_stability | L2 | 1,500 | 0.608 | `right` |
| physical_stability | L3 | 1,500 | 0.312 | `D` |
| physical_stability | L4 | 1,500 | 0.510 | `stable` |
| physical_stability | L5 | 1,500 | 0.155 | `unstable; after removing block C, the cumulative center of mass at the joint between block B and block A lies outside its supporting base` |
| polyhedron | L1 | 1,500 | 0.219 | `14` |
| polyhedron | L2 | 1,500 | 0.899 | `convex` |
| polyhedron | L3 | 1,500 | 0.127 | `mixed` |
| polyhedron | L4 | 1,500 | 0.276 | `no` |
| polyhedron | L5 | 1,500 | 1.000 | `no` |
| projectile_motion | L1 | 1,000 | 0.028 | `31` |
| projectile_motion | L2 | 1,000 | 0.654 | `no` |
| projectile_motion | L3 | 1,000 | 0.010 | `22.2` |
| projectile_motion | L4 | 1,000 | 0.004 | `{'time_of_flight_s': 1.7, 'range_m': 12.2}` |
| projectile_motion | L5 | 1,000 | 0.688 | `increase` |
| rotation_matching | L1 | 1,500 | 0.262 | `8` |
| rotation_matching | L2 | 1,500 | 0.257 | `B` |
| rotation_matching | L3 | 1,500 | 0.156 | `90` |
| rotation_matching | L4 | 1,500 | 0.261 | `A` |
| rotation_matching | L5 | 1,500 | 0.159 | `135` |
| route | L1 | 1,500 | 0.243 | `6` |
| route | L2 | 1,500 | 0.518 | `1` |
| route | L3 | 1,500 | 0.118 | `3` |
| route | L4 | 1,500 | 0.038 | `CD` |
| route | L5 | 1,500 | 0.268 | `5` |
| rpm | L1 | 1,500 | 0.421 | `1` |
| rpm | L2 | 1,500 | 0.141 | `6` |
| rpm | L3 | 1,500 | 0.385 | `wrong in some other way` |
| rpm | L4 | 1,500 | 0.218 | `8` |
| rpm | L5 | 1,500 | 0.656 | `9` |
| shadow_inference | L1 | 1,500 | 0.375 | `2` |
| shadow_inference | L2 | 1,500 | 0.368 | `left` |
| shadow_inference | L3 | 1,500 | 0.305 | `high` |
| shadow_inference | L4 | 1,500 | 0.395 | `same` |
| shadow_inference | L5 | 1,500 | 0.508 | `shorter` |
| surface_topology | L1 | 1,500 | 0.281 | `1` |
| surface_topology | L2 | 1,500 | 0.739 | `orientable` |
| surface_topology | L3 | 1,500 | 0.521 | `0` |
| surface_topology | L4 | 1,500 | 0.267 | `0; orientable` |
| surface_topology | L5 | 1,500 | 0.528 | `-1` |
| symmetry_pattern | L1 | 1,500 | 0.559 | `8` |
| symmetry_pattern | L2 | 1,500 | 0.507 | `symmetric` |
| symmetry_pattern | L3 | 1,500 | 0.285 | `rotational` |
| symmetry_pattern | L4 | 1,500 | 0.283 | `8` |
| symmetry_pattern | L5 | 1,500 | 1.000 | `yes` |

## Appendix B - per-domain adjusted scores (pooled over the domain's levels)

| domain | Qwen-I | Pixtral | Molmo2 | Qwen-T | InternVL | Kimi | DeepSeek | n | baseline |
|---|---|---|---|---|---|---|---|---|---|
| angle_estimation | +0.3195 | +0.1262 | +0.1339 | +0.2729 | +0.1823 | +0.1077 | +0.1038 | 7,500 | 0.272 |
| clock_reading | +0.2497 | +0.0270 | +0.2473 | +0.3282 | +0.1520 | +0.1136 | +0.0572 | 7,500 | 0.125 |
| combination | +0.0477 | -0.0269 | +0.1263 | +0.0181 | +0.0330 | -0.1132 | -0.0557 | 7,500 | 0.337 |
| combination3d | +0.0561 | +0.0751 | +0.0367 | -0.0663 | +0.0184 | -0.0900 | -0.0306 | 7,500 | 0.252 |
| compass_bearing | +0.2578 | +0.2529 | +0.2218 | +0.2467 | +0.2290 | -0.0379 | +0.1092 | 7,500 | 0.202 |
| coordinate_geometry | +0.3667 | -0.0611 | +0.1615 | +0.1180 | +0.0009 | +0.0262 | -0.0219 | 7,500 | 0.131 |
| cube_net | +0.5577 | +0.2338 | +0.1428 | +0.1465 | +0.2592 | +0.1141 | +0.1417 | 6,000 | 0.408 |
| cube_structure | -0.0133 | -0.0861 | -0.1426 | -0.0804 | -0.1167 | -0.1817 | -0.2464 | 7,500 | 0.306 |
| depth_height | +0.4342 | +0.4149 | +0.4621 | +0.4523 | +0.4773 | +0.4088 | +0.1721 | 7,500 | 0.197 |
| embedded_figures | -0.0378 | -0.0104 | +0.0759 | +0.0252 | -0.3030 | -0.1570 | -0.2276 | 7,500 | 0.322 |
| fbd | +0.2593 | +0.2290 | +0.1768 | +0.2249 | +0.1456 | +0.0502 | -0.0887 | 7,500 | 0.252 |
| fold_punch | +0.0579 | -0.0554 | +0.0907 | -0.0410 | -0.1854 | -0.0300 | -0.0964 | 7,500 | 0.392 |
| gauge_reading | +0.1768 | +0.1295 | +0.2475 | +0.2004 | +0.1951 | +0.0920 | +0.1071 | 7,500 | 0.400 |
| gear_train | +0.5268 | +0.3315 | +0.3705 | +0.5605 | +0.2386 | +0.2564 | -0.1617 | 6,000 | 0.252 |
| hex_pathfinding | -0.1293 | -0.1956 | -0.1461 | -0.1163 | -0.2520 | -0.1291 | -0.1489 | 7,500 | 0.279 |
| impossible_object | -0.3133 | -0.3582 | -0.3372 | -0.4169 | -0.3675 | -0.3124 | -0.2141 | 7,500 | 0.398 |
| laser_mirror | +0.0408 | +0.0046 | +0.0309 | -0.0123 | +0.0260 | -0.1446 | -0.0541 | 7,500 | 0.328 |
| line_intersection | +0.3936 | +0.2767 | +0.2220 | +0.3840 | +0.1806 | +0.0510 | +0.0190 | 7,500 | 0.320 |
| nested_hexagons | -0.0334 | -0.0470 | -0.0241 | -0.1653 | -0.0078 | -0.0495 | -0.0270 | 7,500 | 0.265 |
| nested_squares | -0.0498 | -0.0468 | +0.0055 | -0.1830 | -0.0379 | -0.0760 | +0.0348 | 7,500 | 0.268 |
| nested_triangles | -0.0431 | -0.0682 | -0.0333 | -0.1765 | -0.0598 | -0.0689 | -0.0198 | 7,500 | 0.267 |
| occluded_pattern | +0.0562 | +0.0294 | +0.0324 | +0.1554 | -0.0687 | -0.0674 | -0.0270 | 7,500 | 0.239 |
| optical_illusion | -0.3341 | -0.1802 | -0.3085 | -0.4740 | -0.4364 | -0.4690 | -0.3594 | 6,000 | 0.500 |
| orthographic | +0.0894 | +0.1185 | +0.1700 | -0.0498 | +0.1820 | -0.0870 | +0.2552 | 6,000 | 0.301 |
| overlap_circles | +0.1411 | +0.0668 | +0.1274 | +0.0932 | +0.0894 | +0.0248 | +0.0760 | 7,500 | 0.203 |
| physical_stability | -0.6088 | +0.1064 | +0.2954 | +0.1045 | +0.0463 | -0.0109 | -0.1030 | 7,500 | 0.378 |
| polyhedron | +0.3781 | +0.3939 | +0.1629 | +0.3361 | +0.2423 | +0.1933 | +0.0739 | 6,000 | 0.380 |
| projectile_motion | +0.6612 | +0.5686 | +0.2976 | +0.8103 | +0.6294 | +0.2431 | +0.2226 | 5,000 | 0.277 |
| rotation_matching | +0.3113 | +0.2558 | +0.2290 | +0.2891 | +0.2249 | +0.1779 | +0.0480 | 7,500 | 0.219 |
| route | -0.0323 | +0.0440 | -0.0613 | -0.0736 | -0.0792 | -0.1115 | -0.0131 | 7,500 | 0.237 |
| rpm | +0.3082 | +0.2634 | -0.0008 | +0.3940 | -0.0245 | -0.1137 | -0.1856 | 7,500 | 0.364 |
| shadow_inference | +0.5219 | +0.4569 | +0.3727 | +0.5330 | +0.2609 | +0.3570 | -0.0733 | 7,500 | 0.390 |
| surface_topology | +0.4824 | +0.5254 | +0.1880 | +0.2698 | +0.2270 | +0.0851 | -0.0991 | 7,500 | 0.467 |
| symmetry_pattern | +0.0643 | +0.1497 | +0.2666 | +0.1074 | +0.0837 | -0.0034 | +0.1113 | 6,000 | 0.409 |

## Appendix C - cross-run integrity

- one question per image per level: 0 violations in 1190 cells
- ground truth identical across runs: 15 of 1020 compared cells differ, all of them cells whose evaluated sample size differs between runs (angle_estimation 1,501 vs 1,500 images; projectile_motion 1,000 vs 1,500). Everywhere else the comparison is exactly paired.
- one recorded ground truth per question id and level, so baselines are shared across all six models

