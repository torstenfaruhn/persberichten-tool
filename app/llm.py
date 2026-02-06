from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import urllib.request


@dataclass
class LLMResult:
    kop: str
    intro: str
    body: str
    used_llm: bool
    raw: str | None = None


OPENAI_CHAT_COMPLETIONS_URL = os.getenv("OPENAI_CHAT_COMPLETIONS_URL", "https://api.openai.com/v1/chat/completions")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")


def call_openai_chat(api_key: str, system_prompt: str, user_prompt: str, timeout_s: int = 60) -> str:
    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OPENAI_CHAT_COMPLETIONS_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read().decode("utf-8")
    return raw


def parse_llm_json(raw: str) -> Tuple[str, str, str]:
    """
    Expect the model to return JSON with keys: kop, intro, body.
    """
    obj = json.loads(raw)
    # OpenAI format
    content = obj["choices"][0]["message"]["content"]
    # Content may be fenced
    content_str = content.strip()
    content_str = content_str.removeprefix("```json").removeprefix("```").strip()
    content_str = content_str.removesuffix("```").strip()
    data = json.loads(content_str)
    return data["kop"].strip(), data["intro"].strip(), data["body"].strip()


def rewrite_with_llm(api_key: str, style_blob: str, source_text: str) -> LLMResult:
    system_prompt = (
        "Je bent een redacteur voor De Limburger. "
        "Herschrijf persberichten naar neutrale, journalistieke stijl op B1-niveau. "
        "Volg de meegeleverde stijlrichtlijnen. "
        "Geef uitsluitend JSON terug met sleutels: kop, intro, body. "
        "Geen extra tekst."
        "\n\nSTIJLRICHTLIJNEN (samengevat/bron):\n"
        f"{style_blob}\n"
    )
    user_prompt = (
        "Herschrijf dit persbericht.\n\n"
        "Eisen:\n"
        "- Kop: 100–150 tekens.\n"
        "- Intro: 200–220 tekens.\n"
        "- Body: neutraal, feitelijk, geen marketingtaal; houd 5W in stand.\n"
        "- Gebruik absolute datums (bijv. '6 februari 2026') i.p.v. 'vandaag/morgen' als dat uit de context nodig is.\n"
        "- Voeg geen contactblok toe tenzij essentieel.\n"
        "- Output als JSON.\n\n"
        "PERSBERICHT:\n"
        f"{source_text}"
    )
    raw = call_openai_chat(api_key, system_prompt, user_prompt, timeout_s=60)
    kop, intro, body = parse_llm_json(raw)
    return LLMResult(kop=kop, intro=intro, body=body, used_llm=True, raw=raw)
