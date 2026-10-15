#!/usr/bin/env python3
"""
SOURCE CLAIMS THAT CONTRADICT THE CODE.

WHY THIS EXISTS
---------------
`packages/questions-api/src/index.ts` said, in three places:

    "Unset = open (local dev only)"

**The code has failed closed since `hasCode` was written.** One of those lines was the module
docstring; two were on the `QuestionsApiDeps` interface, directly above the fields they described
wrongly.

**And the same property was stated CORRECTLY in `apps/relay/src/worker.ts`** — so the repository
documented its most security-critical invariant **both ways, in the same tree.**

**That is the defect this project guards against on its own SITE and nowhere in its SOURCE.** A
comment that contradicts the code is worse than no comment: it is read as the design.

WHAT IT CHECKS
--------------
1. A small set of phrases that assert a SECURITY property, checked against the property the code
   actually implements. Narrow on purpose — it is not a prose linter.
2. **A guard placed in a scope where its variable does not exist.** Round 91 found
   `refuse_without_spend(args, ...)` inside `_apply_patch(im, condition)` — a function with no
   `args` — from a patch that matched "the first else:" in each file. It would have raised
   NameError rather than guarding anything. **A guard in the wrong scope is not a guard**, and it
   is checkable without running the code.

A phrase inside quotes, or preceded by "said", is being DISCUSSED rather than asserted — the same
rule the plan guard uses, because correcting a bad claim requires quoting it.

Usage:
    python scripts/factory/15_source_claims.py
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# ONE PLACE THAT DECIDES WHAT IS OUT OF SCOPE
# ---------------------------------------------------------------------------
#
# THE SEPARATOR AND PREFIX TRAP HAS NOW CAUSED FIVE BUGS, in five different guards:
#
#   round  98  `p.parent / "../x"` CONCATENATED instead of resolved
#   round 110  `"dedup/" in str(p)` — on Windows that is `"dedup\\..."`, so it never matched
#   round 118  the same, in a different guard
#   round 125  `"/.backup/"` missed a path that STARTED with `.backup/`
#   round 126  `".git"` MATCHED `".github"`, so every workflow file was invisible
#
# **Every one was a check being wrong about its own input, and every one was found by planting a
# fault.** Four different spellings of the same idea were living in this file alone.
#
# So there is one function now, and it normalises BEFORE it compares.
_ALWAYS_OUT_OF_SCOPE = (
    "node_modules",      # dependencies
    "/.git/",            # git internals - NOT ".git", which matches ".github"
    "/.kilo/",           # worktree copies
    "/paper/.kilo/",     # worktree copies, under Paper/
    "/.backup/",         # a backup of the old web app
    "/.research/",       # scratch probes
    "/.pytest_cache/",
    "/.takumi",          # a build cache
    "/geomatric",        # a vendored third-party dataset
    "/dedup/",           # a separate tool with its own data
)


def out_of_scope(path) -> bool:
    """Is this path outside the repository's own source?

    NORMALISED FIRST. Every bug this replaces came from comparing a raw string: a Windows
    separator, a leading dot, or a substring that matched more than it should.
    """
    s = str(path).replace(chr(92), "/").lower()
    if not s.startswith("/"):
        s = "/" + s
    return any(x in s for x in _ALWAYS_OUT_OF_SCOPE)

SOURCES = ("apps/relay/src", "packages/questions-api/src", "packages/site/src")

# (regex, why it contradicts the code)
FORBIDDEN = [
    (r"unset\s*[=:]\s*open",
     "hasCode FAILS CLOSED: an unset secret disables the door, it never opens it"),
    # AUTH-SCOPED ONLY. The first version matched a bare "fails open" and flagged
    # `overWriteLimit`, which fails open ON PURPOSE — a rate limit must not block authoring when
    # the table is missing. That is a different property, correctly documented, and flagging it
    # would have been a true statement about a false subject.
    (r"(auth|secret|code|door|access)[^.\n]{0,60}fails?\s+open",
     "the privileged doors fail closed; only /api/chat once did, and that was a BUG"),
    (r"no\s+auth(entication)?\s+(is\s+)?(required|needed)",
     "the privileged doors require their code, always, by design"),
]

# A phrase is DISCUSSED, not asserted, when it follows one of these.
# DISCUSSED, NOT ASSERTED. Correcting a bad claim requires quoting it, and describing a bug
# requires naming it — so past-tense and attributive markers count as discussion. Line 19 of
# index.ts says "that actually DID fail open — so this line was describing the bug", which is the
# correction itself and must not be flagged.
_QUOTING = re.compile(
    r"""(said|says|saying|described|describing|call(?:ed)? as|was|were|did|once|used to|"
       |'|\u201c|\u2018|\bnot\b)[^.!?]*$""".replace("\n", ""),
    re.I | re.X)


def check_text(text: str) -> list[tuple[int, str, str]]:
    """(line number, the phrase, why it is wrong) for every ASSERTED contradiction."""
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        for pat, why in FORBIDDEN:
            m = re.search(pat, line, re.I)
            if not m:
                continue
            before = line[: m.start()]
            # quoted is discussed
            if before.rstrip().endswith(("\"", "'", "\u201c", "\u2018")):
                continue
            if _QUOTING.search(before):
                continue
            out.append((i, m.group(0), why))
    return out


def check_file(p: pathlib.Path) -> list[dict]:
    out = []
    for ln, phrase, why in check_text(p.read_text(encoding="utf-8-sig", errors="ignore")):
        out.append({"file": str(p.relative_to(ROOT)).replace("\\", "/"),
                    "line": ln, "phrase": phrase, "why": why})
    return out



# ---------------------------------------------------------------------------
# A PAID HOST OUTSIDE THE GUARDED RUNNERS
# ---------------------------------------------------------------------------

# Hosts that bill per call. EVERY reference to one must be in a file this list allows, and each
# allowed file must be justified in its own entry - the same shape as the allowlist in
# 12_unwired.py, because **an exemption whose reason is not written down cannot be reviewed.**
PAID_HOSTS = (
    "openrouter.ai",
    "api.openai.com",
    "api.anthropic.com",
    "api.groq.com",
    "api.mistral.ai",
    "generativelanguage.googleapis.com",
)

PAID_HOST_ALLOWED = {
    "scripts/harness/backends.py": "the ONE place that spends: it is what the spend guard guards",
    "scripts/factory/02_generate_questions.py": "a PAID pipeline stage; refuses without --spend",
    "scripts/factory/04_tag_ground.py": "a PAID pipeline stage; refuses without --spend",
    "scripts/harness/sweep.py": "the shared sweep CLI; refuses without --spend",
    "packages/site/src/questions.ts":
        "BROWSER-DIRECT, BYOK - the key is a caller PARAMETER from the visitor's own settings, so"
        " it is the visitor's spend and never a project credential",
    "scripts/factory/costs.md": "prose that prices the spend",
    "scripts/harness/selftest.py":
        "THE TEST OF THIS RULE names every host it forbids, because a check that cannot say what it"
        " looks for cannot be shown to look for anything",
}


def find_unexpected_paid_hosts(base: pathlib.Path) -> list[dict]:
    """A reference to a billing host in a file that is not allowed to have one.

    ROUND 125 FOUND FIVE MODEL PROVIDERS while auditing every host in the repository. All five
    turned out to be inside a GITIGNORED backup - dead files, no risk - but **finding them
    required a hand audit, and the next one would require another.**

    So the audit is a check: a billing host may appear only in a file on the list, and every
    entry on the list states why.
    """
    out = []
    # THIS FILE NAMES EVERY BILLING HOST, so it would flag itself. A scanner must exclude its own
    # list, or the list can never be updated - **a check that fails on its own configuration**.
    me = pathlib.Path(__file__).resolve()
    for p in sorted(base.rglob("*")):
        if not p.is_file() or p.suffix not in (".py", ".ts", ".tsx"):
            continue
        if p.resolve() == me:
            continue
        posix = p.as_posix()
        # WORKTREES AND SCRATCH ARE NOT THE TREE. `.kilo/worktrees/` and `Paper/.kilo/worktrees/`
        # hold full COPIES of this repository, and `.research/` holds probes — so flagging them
        # reports one file six times and buries the real answers. Every other guard excludes them
        # for the same reason.
        # BOTH FORMS. A path may CONTAIN "/.backup/" or may START with ".backup/" - and the first
        # version tested only the form with a leading slash, so **the whole exclusion list silently
        # did nothing** and the check reported the twenty files it was written to ignore.
        # ALWAYS PREFIX A SLASH so one test covers both a path that starts with the directory and
        # one that merely contains it. The first version tested only "/.backup/" (missing
        # ".backup/...") and the second only special-cased a leading dot (breaking it again).
        if out_of_scope(posix):
            continue
        # A RELATIVE PATH, because that is what the allowlist is written in. The first version
        # compared an ABSOLUTE path against relative keys, so **every allowed file was flagged and
        # the check reported the very files it was written to permit.**
        try:
            rel = p.resolve().relative_to(pathlib.Path(base).resolve()).as_posix()
        except ValueError:
            rel = posix
        try:
            text = p.read_text(encoding="utf-8-sig", errors="ignore")
        except Exception:
            continue
        for host in PAID_HOSTS:
            if host not in text:
                continue
            if rel in PAID_HOST_ALLOWED:
                continue
            out.append({"file": rel, "host": host})
    return out


# A SPEND SURFACE THAT NAMES NO HOST.
#
# THE HOST SCAN CANNOT SEE THE RELAY'S CHAT. It spends through \`createGateway({ apiKey:
# env.GATEWAY_KEY })\` and \`env.AI.run(...)\` - a BINDING and a secret, with no URL anywhere in
# the file. Found in round 129 by searching for the pattern instead of the host.
#
# So a second list: a file that references a spend BINDING must be one this list allows, and
# every entry says why - the same shape as the host allowlist beside it.
SPEND_BINDING_MARKERS = (
    "env.AI",
    ".AI!.run",
    "createGateway(",
    "GATEWAY_KEY",
)

SPEND_BINDING_ALLOWED = {
    "apps/relay/src/worker.ts":
        "the chat door. It FAILS CLOSED (unset ACCESS_CODE disables it) and it now has NO CALLER"
        " in the repository - the page was deleted in round 129. Ticket 24 is whether the route"
        " itself is deleted",
    "scripts/factory/15_source_claims.py": "this list",
    "scripts/harness/selftest.py": "the test of this rule",
}


def find_spend_bindings(base: pathlib.Path) -> list[dict]:
    """A file referencing a spend binding that is not allowed to have one."""
    out = []
    me = pathlib.Path(__file__).resolve()
    for p in sorted(base.rglob("*")):
        if not p.is_file() or p.suffix not in (".py", ".ts", ".tsx"):
            continue
        if p.resolve() == me or out_of_scope(p):
            continue
        try:
            text = p.read_text(encoding="utf-8-sig", errors="ignore")
        except Exception:
            continue
        if not any(m in text for m in SPEND_BINDING_MARKERS):
            continue
        try:
            rel = p.resolve().relative_to(pathlib.Path(base).resolve()).as_posix()
        except ValueError:
            rel = p.as_posix()
        if rel not in SPEND_BINDING_ALLOWED:
            out.append({"file": rel})
    return out


# ---------------------------------------------------------------------------
# A LINK TO A PAGE THAT DOES NOT EXIST
# ---------------------------------------------------------------------------

# FIVE ROUTES WERE DELETED IN ROUNDS 129 AND 132 (ask, method, prior-art, alternatives,
# project). The links were unwrapped by hand at the time, and hand work does not scale: a
# `to=` or `navigate({ to: })` left pointing at a deleted route renders a dead link on a
# deployed site, and **nothing in this repository checked it** - TypeScript's typed routes help
# only where the route tree has regenerated.
def find_dead_route_links(base: pathlib.Path) -> list[dict]:
    """An internal route referenced by the web app that no route file defines."""
    routes_dir = base / "apps" / "web" / "src" / "routes"
    if not routes_dir.exists():
        return []
    # a route file `gallery.triage.tsx` is the path `/gallery/triage`
    known = set()
    for p in routes_dir.glob("*.tsx"):
        name = p.stem
        if name.startswith("__") or name == "routeTree":
            continue
        known.add("/" + name.replace(".index", "").replace(".", "/"))
        known.add("/" + name.replace(".", "/"))
    out = []
    pattern = re.compile(r'(?:to:|href=)["\' ]*"(/[a-z0-9/\-]*)"')
    for p in sorted((base / "apps" / "web" / "src").rglob("*.ts*")):
        if out_of_scope(p):
            continue
        try:
            text = p.read_text(encoding="utf-8-sig", errors="ignore")
        except Exception:
            continue
        for m in pattern.finditer(text):
            target = m.group(1)
            if target in known or target == "/":
                continue
            out.append({"file": p.relative_to(base).as_posix(), "route": target})
    return out


# ---------------------------------------------------------------------------
# A BUILD ARTIFACT THAT IS TRACKED
# ---------------------------------------------------------------------------
#
# TWICE NOW. Round 134 committed `.dryrun/`; round 148 committed `.dryrun2/`, `.dryrun3/` and
# `.dryrun4/` - because the gitignore line named one directory instead of the pattern, and a
# wrangler `--outdir` writes wherever it is told.
#
# **A fix that matches an instance and not the pattern is a fix that expires.** The gitignore is
# `.dryrun*/` now, and this is the check that would have caught both.
_ARTIFACT_DIRS = ("dist", "build", ".next", ".turbo", ".wrangler", ".dryrun", "node_modules")


def find_tracked_artifacts(base: pathlib.Path) -> list[str]:
    """Paths inside a build-output directory that git is tracking."""
    import subprocess
    try:
        out = subprocess.run(["git", "ls-files"], capture_output=True, text=True,
                             cwd=str(base), timeout=60)
    except Exception:
        return []
    if out.returncode != 0:
        return []
    hits = []
    for line in out.stdout.splitlines():
        parts = line.split("/")
        for part in parts[:-1]:
            if part in _ARTIFACT_DIRS or part.startswith(".dryrun"):
                hits.append(line)
                break
    return sorted(set(hits))

def find_problems(base: pathlib.Path) -> list[dict]:
    out = []
    for d in SOURCES:
        dd = base / d
        if not dd.exists():
            continue
        for p in sorted(dd.rglob("*")):
            if p.suffix not in (".ts", ".tsx"):
                continue
            out.extend(check_file(p))
    return out


# ---------------------------------------------------------------------------
# A GUARD IN A SCOPE WHERE ITS VARIABLE DOES NOT EXIST
# ---------------------------------------------------------------------------

# Calls that need a name to be in scope to work at all.
NEEDS_NAME = {"refuse_without_spend": "args"}


def _enclosing_arg_names(func) -> set[str]:
    """Names assigned anywhere inside a function body, plus its parameters."""
    import ast as _ast

    names = set()
    if isinstance(func, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
        for a in list(func.args.args) + list(func.args.kwonlyargs) + list(func.args.posonlyargs):
            names.add(a.arg)
        if func.args.vararg:
            names.add(func.args.vararg.arg)
        if func.args.kwarg:
            names.add(func.args.kwarg.arg)
    for node in _ast.walk(func):
        if isinstance(node, _ast.Name) and isinstance(node.ctx, _ast.Store):
            names.add(node.id)
        elif isinstance(node, _ast.arg):
            names.add(node.arg)
    return names


def find_bad_scope(path: pathlib.Path) -> list[dict]:
    """Calls to a guard whose required name is not in scope."""
    import ast as _ast

    try:
        tree = _ast.parse(path.read_text(encoding="utf-8-sig"), str(path))
    except SyntaxError:
        return []
    out = []
    for func in [n for n in _ast.walk(tree)
                 if isinstance(n, (_ast.FunctionDef, _ast.AsyncFunctionDef))]:
        available = _enclosing_arg_names(func)
        for node in _ast.walk(func):
            if not isinstance(node, _ast.Call):
                continue
            fname = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            need = NEEDS_NAME.get(fname or "")
            if not need:
                continue
            if need not in available:
                try:
                    shown = str(path.resolve().relative_to(ROOT))
                except ValueError:
                    shown = str(path)
                out.append({"file": shown.replace("\\", "/"),
                            "line": node.lineno, "call": fname, "missing": need,
                            "function": func.name})
    return out


# ---------------------------------------------------------------------------
# UNUSED IMPORTS
# ---------------------------------------------------------------------------

def find_unused_imports(base: pathlib.Path) -> list[dict]:
    """Imports nothing refers to, by AST.

    `from __future__ import annotations` is EXCLUDED: it is required, and it is never referenced
    by name — a naive check flags it in 45 files and buries the real hits. That false-positive
    flood is why I wrote the filter before looking at the results the first time.
    """
    import ast as _ast

    out = []
    for d in ("scripts/harness", "scripts/factory"):
        dd = base / d
        if not dd.exists():
            continue
        for p in sorted(dd.glob("*.py")):
            try:
                tree = _ast.parse(p.read_text(encoding="utf-8-sig"), str(p))
            except SyntaxError:
                continue
            imported: dict[str, int] = {}
            for node in _ast.walk(tree):
                if isinstance(node, _ast.Import):
                    for a in node.names:
                        imported[(a.asname or a.name).split(".")[0]] = node.lineno
                elif isinstance(node, _ast.ImportFrom):
                    if node.module == "__future__":
                        continue
                    for a in node.names:
                        if a.name != "*":
                            imported[a.asname or a.name] = node.lineno
            used = {n.id for n in _ast.walk(tree) if isinstance(n, _ast.Name)}
            src = p.read_text(encoding="utf-8-sig")
            for name, ln in sorted(imported.items()):
                if name in used or src.count(name) > 1:
                    continue
                out.append({"file": str(p.relative_to(base)).replace("\\", "/"),
                            "line": ln, "name": name})
    return out


# ---------------------------------------------------------------------------
# COUNTS IN PROSE THAT THE CODE SETTLES
# ---------------------------------------------------------------------------

# A COUNT THE GUARD CANNOT VERIFY, AND WHY THE CHECK IS INVERTED
#
# The README said "48 assertions across 8 sections" while the selftest ran 326 — stale for many
# rounds, and nothing noticed. So I added a check comparing the claim against a static count of
# `check(` lines.
#
# **The static count was wrong.** Many assertions sit in `try/except` pairs where only ONE branch
# runs — `check(..., False, "it built")` in the `try` and the real assertion in the `except` — so a
# text count OVERCOUNTS by exactly the number of such pairs.
#
# That makes a precise assertion count **not statically verifiable at all**. So the rule is the
# one from round 65, applied here: **do not state a number the guard cannot check.** The README
# now states the SHAPE, and this reports any source README that goes back to stating a count.
_UNVERIFIABLE_COUNT = re.compile(r"\b\d[\d,]*\s+assertions\b", re.I)


def find_stale_counts(base: pathlib.Path) -> list[dict]:
    """Source READMEs stating an assertion count, which cannot be checked statically."""
    out = []
    for p in sorted(base.glob("scripts/**/README.md")):
        for i, line in enumerate(p.read_text(encoding="utf-8-sig").splitlines(), 1):
            m = _UNVERIFIABLE_COUNT.search(line)
            if m:
                out.append({"file": str(p.relative_to(base)).replace("\\", "/"),
                            "line": i, "claimed": m.group(0), "actual": 0, "noun": "assertions"})
    return out


# ---------------------------------------------------------------------------
# A README'S REFERENCES AND ITS COVERAGE
# ---------------------------------------------------------------------------

# A REFERENCE TO SOMETHING THAT IS NOT IN THIS REPOSITORY, with the reason. `OPEN_QUESTION_SPEC.md`
# is named AS UPSTREAM in `docs/grip.md` - it lives in the other project - and `GLOSSARY.md` is a
# name the DOMAIN-MODELING SKILL defaults to, quoted in the doc that explains this repo does not use
# it. **Both are correct prose, and a check that reports them is one somebody turns off.**
_EXTERNAL_REFS = {
    "OPEN_QUESTION_SPEC.md": "named as 'upstream' in docs/grip.md - it is in the other project",
    "GLOSSARY.md": "the name the domain-modeling skill defaults to, quoted in docs/agents/domain.md",
    "AGENTS.md":
        "gitignored on purpose, because .scratch/ is private - but it is a REAL file in a working"
        " checkout, and a doc is right to name it",
    "apps/metro-web/public/data/metro-graph.json":
        "a BUILD ARTIFACT, gitignored; the tracked source is data/metro-graph.json and the schema"
        " beside it",
}

_REF = re.compile(r"`([A-Za-z0-9_./-]+\.(?:py|ts|tsx|json|sql|md|yml|jsonc|toml))`")
_REF_PAREN = re.compile(r"\(([A-Za-z0-9_./-]+\.(?:py|ts|tsx|json|sql|md|yml|jsonc|toml))\)")


def find_broken_references(base: pathlib.Path) -> list[dict]:
    """A path a README names that does not resolve.

    RESOLUTION IS RELATIVE TO THE README AND TO THE ROOT. The first version resolved only against
    the root and reported three false positives: `open_models_bake.py` (whose full path is
    `scripts/open_models_bake.py`), `openModelsReport.test.ts` (under `apps/grip-web/`), and
    `wrangler.toml` in the `grip-sync` README, which sits beside it.

    **A bare filename in prose is not a claim about the root.** Checking one way and reporting
    three problems for a correct README is how a guard gets switched off.
    """
    out = []
    # READMEs, PLUS THE ALWAYS-LOADED AGENT FILES. AGENTS.md is in every agent's context on EVERY
    # TURN, so a path it names that does not resolve is the most expensive stale claim in the
    # repo — read constantly and never checked.
    # PLUS THE HANDBOOKS. `docs/*.md` are the repo's own description of itself and were checked
    # by NOTHING — an architecture handbook that said "last verified 2026-08-27" while naming
    # 5 of 9 workflows, a photo count 1,800 out, and a chat marked live when its door fails
    # closed. **Nothing watched the file whose job is to describe everything.**
    _targets = (list(base.glob("**/README.md"))
                + list(base.glob("docs/**/*.md"))
                + list(base.glob("docs/*.md"))
                + [base / "AGENTS.md", base / "CLAUDE.md"])
    for p in [x for x in _targets if x.exists()]:
        # OTHER PROJECTS IN THIS MONOREPO ARE OUT OF SCOPE, exactly as they are for the unwired
        # guard. `dedup/` is its own tool with its own data files, and flagging it would be a
        # true statement about a false subject.
        # as_posix(), NOT str(). On Windows `str(p)` is "dedup\README.md" and the test for
        # "dedup/" never matched — the same separator trap three other guards have hit.
        if out_of_scope(p):
            continue
        text = p.read_text(encoding="utf-8-sig", errors="ignore")
        refs = set(_REF.findall(text)) | set(_REF_PAREN.findall(text))
        for r in sorted(refs):
            if r in _EXTERNAL_REFS:
                continue
            # THE PATH IS RESOLVED, NOT CONCATENATED. \`p.parent / "../.scratch/x.md"\` does NOT
            # resolve; \`(p.parent / r).resolve()\` does. The first version concatenated and reported
            # the harness README for naming a file that is exactly where it says it is.
            if (base / r).resolve().exists() or (p.parent / r).resolve().exists():
                continue
            # A SHORTHAND IS NOT AN ERROR. `open_models_bake.py` means `scripts/open_models_bake.py`.
            # Resolution is by SUFFIX, over the tree MINUS the worktree copies — the first version
            # required a unique basename and the three copies in .kilo/ and Paper/.kilo/ defeated
            # it.
            # "\\.git" MATCHES ".github" — THE SAME SUBSTRING TRAP AS ROUND 125. Every workflow
            # file was therefore invisible to the search, so \`deploy.yml\` found ZERO hits and was
            # reported as broken while sitting at \`.github/workflows/deploy.yml\`.
            hits = [q for q in base.glob("**/" + r.lstrip("./")) if not out_of_scope(q)]
            # ZERO HITS IS A BROKEN REFERENCE; SEVERAL IS A SHORTHAND. \`version.json\` exists in
            # two public data folders and a doc naming it is not wrong. Requiring exactly one was
            # too strict and reported correct documents.
            if hits:
                continue
            out.append({"file": str(p.relative_to(base)).replace("\\", "/"), "ref": r})
    return out


# A README that documents a directory should name the files in it. The harness README omitted
# NINE of twenty-two modules, including `spend.py` — the file that enforces the owner's spend
# rule — and nothing noticed, because an omission has no line to grep.
COVERAGE = {
    "scripts/harness/README.md": ("scripts/harness", "*.py"),
}


def find_coverage_gaps(base: pathlib.Path) -> list[dict]:
    out = []
    for readme, (d, pat) in COVERAGE.items():
        rp = base / readme
        dd = base / d
        if not rp.exists() or not dd.exists():
            continue
        text = rp.read_text(encoding="utf-8-sig", errors="ignore")
        for mod in sorted(dd.glob(pat)):
            if mod.name == "__init__.py":
                continue
            if mod.name not in text:
                out.append({"readme": readme, "missing": mod.name})
    return out


def find_scope_problems(base: pathlib.Path) -> list[dict]:
    out = []
    for d in ("scripts/harness", "scripts/factory"):
        dd = base / d
        if not dd.exists():
            continue
        for p in sorted(dd.glob("*.py")):
            out.extend(find_bad_scope(p))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Source claims that contradict the code.")
    ap.add_argument("--dir", default=str(ROOT))
    args = ap.parse_args(argv)
    base = pathlib.Path(args.dir)
    if not (base / "apps").exists() and not (base / "packages").exists():
        print("nothing to scan under " + str(base), file=sys.stderr)
        return 2
    problems = find_problems(base)
    scopes = find_scope_problems(base)
    unused = find_unused_imports(base)
    counts = find_stale_counts(base)
    refs = find_broken_references(base)
    gaps = find_coverage_gaps(base)
    artifacts = find_tracked_artifacts(base)
    if artifacts:
        print(str(len(artifacts)) + " TRACKED BUILD ARTIFACT(S):")
        for x in artifacts[:8]:
            print("  " + x)
        print()
        print("A build output belongs in .gitignore, not in the repository. The gitignore line for")
        print("these should match the PATTERN - .dryrun*/ - and not one directory name.")
        print()
        all_problems.append("a check above reported a problem")
    paid_hosts = find_unexpected_paid_hosts(base)
    dead_links = find_dead_route_links(base)
    spend_bindings = find_spend_bindings(base)
    print("scanned the source for claims that contradict the code, for guards in a scope where")
    print("they cannot work, for imports nothing uses, for counts the code settles, for README")
    print("references that do not resolve, for files a README omits, for a BILLING HOST outside a")
    print("file allowed to have one, and for a SPEND BINDING that names no host at all")
    # EVERY NEW CHECK MUST BE ADDED HERE TOO. The first version of the dead-link check collected
    # its findings, printed them, and appended to all_problems at the BOTTOM of main - which this
    # early return never reached. **It printed "OK" while reporting nothing, which is a check that
    # cannot fail**, the defect this file exists to find. Found by planting a link to a deleted
    # route and watching the guard pass.
    if (not problems and not scopes and not unused and not counts and not refs and not gaps
            and not paid_hosts and not spend_bindings and not dead_links and not artifacts):
        print()
        print("OK — no source claim contradicts the documented invariant that an unset")
        print("     privilege secret DISABLES the door, and every guard has its variable.")
        return 0
    print()
    if problems:
        print(str(len(problems)) + " CONTRADICTION(S):")
        for x in problems:
            print("  " + x["file"] + ":" + str(x["line"]))
            print("    says: " + x["phrase"])
            print("    but : " + x["why"])
        print()
        print("A comment that contradicts the code is worse than no comment: it is read as the")
        print("design. This one was read as the design in three places.")
    if scopes:
        print(str(len(scopes)) + " GUARD(S) IN A SCOPE WHERE THEY CANNOT WORK:")
        for x in scopes:
            print("  " + x["file"] + ":" + str(x["line"])
                  + "  " + x["call"] + "(...) inside " + x["function"] + "()")
            print("    but '" + x["missing"] + "' is not defined in that function, so this would")
            print("    raise NameError rather than guard anything.")
        print()
        print("A guard in the wrong scope is not a guard. It reads as protection and provides")
        print("none — and it is what a patch that matches \"the first else:\" produces.")
    if unused:
        print(str(len(unused)) + " UNUSED IMPORT(S):")
        for x in unused:
            print("  " + x["file"] + ":" + str(x["line"]) + "  " + x["name"])
        print()
        print("An unused import is debris from an edit, and it is how a file grows a line that")
        print("says it depends on something it does not.")
    if counts:
        print(str(len(counts)) + " UNVERIFIABLE COUNT(S) IN PROSE:")
        for x in counts:
            print("  " + x["file"] + ":" + str(x["line"]) + "  states " + repr(x["claimed"]))
        print()
        print("A precise assertion count cannot be checked statically — many assertions sit in")
        print("try/except pairs where only one branch runs, so a text count OVERCOUNTS. State the")
        print("shape instead. The number was 48 against 326 and had been stale for many rounds.")
    if refs:
        print(str(len(refs)) + " BROKEN README REFERENCE(S):")
        for x in refs:
            print("  " + x["file"] + "  names " + x["ref"] + ", which does not resolve")
        print()
        print("Resolution is relative to the README and to the root. A path that resolves at")
        print("neither is a reference to something that moved or never existed.")
    if paid_hosts:
        print(str(len(paid_hosts)) + " BILLING HOST(S) OUTSIDE A GUARDED FILE:")
        for x in paid_hosts:
            print("  " + x["file"] + "  references " + x["host"])
        print()
        print("Inference on images is the ONLY permitted spend. A billing host may appear only in a")
        print("file this check allows, and every allowed file must state why.")
        print()
    if dead_links:
        print(str(len(dead_links)) + " LINK(S) TO A ROUTE THAT DOES NOT EXIST:")
        for x in dead_links:
            print("  " + x["file"] + " -> " + x["route"])
        print()
        print("A deleted page leaves a dead link on a deployed site. TypeScript catches this only")
        print("where the route tree has regenerated, so it is checked here.")
        print()
        all_problems.append("a check above reported a problem")
    if spend_bindings:
        print(str(len(spend_bindings)) + " SPEND BINDING(S) OUTSIDE AN ALLOWED FILE:")
        for x in spend_bindings:
            print("  " + x["file"])
        print()
        print("A binding spends without naming a host, so the host scan cannot see it. Add the file")
        print("to SPEND_BINDING_ALLOWED with a reason, or remove the binding.")
        print()
    if gaps:
        print(str(len(gaps)) + " FILE(S) A README OMITS:")
        for x in gaps:
            print("  " + x["readme"] + " does not mention " + x["missing"])
        print()
        print("An omission has no line to grep, which is why nine absent modules went unnoticed")
        print("in the harness README — including spend.py, the file that enforces the spend rule.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
