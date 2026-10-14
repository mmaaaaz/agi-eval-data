"""The frozen recipe: every setting that can change a number, in one hashed object.

Published with the results. If two runs disagree and only this differs, that is the
explanation, and it is checkable.
"""
from __future__ import annotations
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Recipe:
    model: str
    prompt_id: str = "mcq_v1"
    temperature: float = 0.0
    top_p: float = 1.0
    max_tokens: int = 512
    pixel_budget: int = 2048
    retries: int = 1
    seed: int = 0
    repeats: int = 1
    # images are fetched from the corpus CDN, the same bytes the site shows
    image_url_template: str = "https://lh3.googleusercontent.com/d/{file_id}=w{pixel_budget}"
    notes: str = ""

    def image_url(self, file_id: str) -> str:
        return self.image_url_template.format(file_id=file_id, pixel_budget=self.pixel_budget)

    def canonical(self) -> str:
        return json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))

    def recipe_hash(self) -> str:
        return hashlib.sha256(self.canonical().encode()).hexdigest()

    def save(self, path: str | Path) -> None:
        Path(path).write_text(self.canonical() + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "Recipe":
        return cls(**json.loads(Path(path).read_text(encoding="utf-8-sig")))


PROMPTS: dict[str, str] = {
    "mcq_v1": (
        "Answer the question about the image.\n"
        "Reply with the letter of the correct option and nothing else.\n"
        "If the image does not contain the information needed, reply exactly: UNKNOWN\n\n"
        "Question: {question}\n"
        "Options:\n{options}"
    ),
    "open_v1": (
        "Answer the question about the image in one short sentence.\n"
        "If the image does not contain the information needed, reply exactly: UNKNOWN\n\n"
        "Question: {question}"
    ),
    "yesno_v1": (
        "Answer the question about the image with exactly one word: yes or no.\n"
        "If the image does not contain the information needed, reply exactly: UNKNOWN\n\n"
        "Question: {question}"
    ),
    # THE BLIND PROMPT. There is no image, and the model is told so rather than left
    # to guess. Anything answered correctly here is solvable from language priors and
    # the option shapes alone, which is the single cheapest threat to a vision
    # benchmark and the reason the gate has a blind-solvability check at all.
    "blind_v1": (
        "You are answering a question WITHOUT seeing any image.\n"
        "Answer from the question text and the options alone.\n"
        "If the question cannot be answered without the image, reply exactly: UNKNOWN\n\n"
        "Question: {question}\n"
        "Options:\n{options}"
    ),
}


def render_prompt(recipe: Recipe, question: str, choices: list[str] | None) -> str:
    template = PROMPTS.get(recipe.prompt_id)
    if template is None:
        raise KeyError("unknown prompt_id " + recipe.prompt_id)
    options = ""
    if choices:
        options = "\n".join(chr(65 + i) + ") " + c for i, c in enumerate(choices))
    return template.format(question=question, options=options)
