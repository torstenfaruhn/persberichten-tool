from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Tuple


@dataclass
class ValidationResult:
    ok: bool
    error_code: str | None = None
    error_message: str | None = None
    warnings: List[Tuple[str, str]] = None  # [(code, message)]
    meta: Dict[str, str] = None


def normalize_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # normalize spaces
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def count_chars_including_spaces(text: str) -> int:
    return len(text)


def detect_multiple_press_releases(text: str) -> bool:
    """
    Heuristic: detect multiple press releases in one file.
    We treat repeated hard markers or repeated typical "kop + intro" blocks as a signal.
    """
    t = text.lower()
    markers = [
        "persbericht",
        "einde persbericht",
        "press release",
    ]
    count = sum(t.count(m) for m in markers)
    # If "persbericht" appears twice or more, it's likely multiple items,
    # but allow single header mention by requiring >=2 total marker hits AND >=2 "persbericht".
    if t.count("persbericht") >= 2:
        return True
    # Alternative: multiple datelines (dd maand yyyy) separated widely
    datelines = re.findall(r"\b(\d{1,2}\s+(jan(uari)?|feb(ruari)?|mrt|maart|apr(il)?|mei|jun(i)?|jul(i)?|aug(ustus)?|sep(tember)?|okt(ober)?|nov(ember)?|dec(ember)?)\s+\d{4})\b", t)
    if len(datelines) >= 2:
        return True
    return False


def five_w_check(text: str) -> Dict[str, bool]:
    """
    Lightweight 5W(+H) presence detection for Dutch.
    This is heuristic; we use it to decide 'stop' when too many are missing.
    """
    t = text.lower()

    # Wie: names/organizations often start with capital letters; heuristic via explicit patterns
    wie = bool(re.search(r"\b(wie|door|namens)\b", t)) or bool(re.search(r"\b(stichting|bv|b\.v\.|gemeente|provincie|ministerie|vereniging|bedrijf)\b", t))
    # Wat
    wat = bool(re.search(r"\b(wat|lanceert|introduceert|opent|start|organiseert|maakt bekend|kondigt aan)\b", t))
    # Waar
    waar = bool(re.search(r"\b(waar|in|te|bij)\b", t)) and bool(re.search(r"\b([a-záéíóúäëïöü\-]{3,})\b", t))
    # Wanneer
    wanneer = bool(re.search(r"\b(vandaag|morgen|gisteren|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b", t)) or bool(re.search(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", t)) or bool(re.search(r"\b\d{1,2}\s+(jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)\w*\b", t))
    # Waarom
    waarom = bool(re.search(r"\b(omdat|zodat|waardoor|met als doel|doel is|vanwege|wegens)\b", t))
    # Hoe
    hoe = bool(re.search(r"\b(door|via|met|door middel van|op basis van|onder meer|zoals)\b", t))

    return {"wie": wie, "wat": wat, "waar": waar, "wanneer": wanneer, "waarom": waarom, "hoe": hoe}


def validate_input(text: str) -> ValidationResult:
    warnings: List[Tuple[str, str]] = []
    meta: Dict[str, str] = {}

    norm = normalize_whitespace(text)

    extractable_chars = len(norm)
    meta["extractable_chars"] = str(extractable_chars)
    if extractable_chars < 800:
        return ValidationResult(False, "E003", "Te weinig extracteerbare tekst (<800 tekens). Mogelijk een scan-PDF of leeg document.", warnings, meta)

    if detect_multiple_press_releases(norm):
        return ValidationResult(False, "E007", "Dit bestand lijkt meerdere persberichten te bevatten. Upload één persbericht per document.", warnings, meta)

    total_chars = count_chars_including_spaces(norm)
    meta["char_count_incl_spaces"] = str(total_chars)
    if total_chars < 950:
        return ValidationResult(False, "E004", "Het persbericht is te kort (<950 tekens incl. spaties).", warnings, meta)

    ws = five_w_check(norm)
    missing = [k for k, v in ws.items() if not v]
    meta["fivew_present"] = str({k: ws[k] for k in ws})
    if len(missing) >= 2:
        return ValidationResult(False, "E006", f"Te weinig basisinformatie: minimaal 5W vereist. Ontbrekend: {', '.join(missing)}.", warnings, meta)

    # Warnings
    if not ws.get("waarom", True):
        warnings.append(("W001", "Waarom ontbreekt of is onduidelijk."))
    if not ws.get("hoe", True):
        warnings.append(("W002", "Hoe ontbreekt of is onduidelijk."))

    # Strong claims (very rough)
    if re.search(r"\b(altijd|nooit|100%|garandeert|bewijs(t)?|de beste|uniek|baanbrekend)\b", norm.lower()):
        warnings.append(("W004", "Mogelijk sterke claim/marketingtaal: verifieer of maak neutraler."))

    # Contact info
    if re.search(r"\b(telefoon|tel\.|e-?mail|@|www\.|http)\b", norm.lower()):
        warnings.append(("W009", "Contact- of linkinformatie aanwezig: neem alleen op als relevant en controleer privacy."))

    return ValidationResult(True, None, None, warnings, meta)


def build_signals(warnings: List[Tuple[str, str]], meta: Dict[str, str]) -> str:
    lines: List[str] = []
    if warnings:
        for code, msg in warnings:
            lines.append(f"- [{code}] {msg}")
    else:
        lines.append("- Geen bijzonderheden gedetecteerd.")
    # add meta hints
    if meta.get("extractable_chars"):
        lines.append(f"- [INFO] Extracteerbare tekens: {meta['extractable_chars']}")
    if meta.get("char_count_incl_spaces"):
        lines.append(f"- [INFO] Tekens incl. spaties: {meta['char_count_incl_spaces']}")
    return "\n".join(lines).strip()


def naive_rewrite(norm_text: str) -> Tuple[str, str, str]:
    """
    Deterministic fallback: create kop/intro/body by extracting and compacting.
    This is NOT stylistically perfect; it's a fallback when no LLM is available.
    """
    # Split into paragraphs
    paras = [p.strip() for p in norm_text.split("\n") if p.strip()]
    first = paras[0] if paras else ""
    # kop: first sentence truncated
    kop = re.split(r"(?<=[.!?])\s+", first)[0].strip()
    if len(kop) > 150:
        kop = kop[:147].rstrip() + "…"
    if len(kop) < 20 and len(first) > 20:
        kop = (first[:150].rstrip() + "…") if len(first) > 150 else first

    # intro: next 1-2 sentences from first two paragraphs
    blob = " ".join(paras[:2])
    sents = re.split(r"(?<=[.!?])\s+", blob)
    intro = " ".join(sents[:2]).strip()
    if len(intro) > 220:
        intro = intro[:217].rstrip() + "…"

    body = "\n\n".join(paras[1:]) if len(paras) > 1 else ""
    body = body.strip()
    if not body:
        body = norm_text

    return kop, intro, body


def enforce_length_warnings(kop: str, intro: str, body: str, source_len: int, warnings: List[Tuple[str, str]]) -> None:
    # kop 100-150
    if not (100 <= len(kop) <= 150):
        warnings.append(("W005", f"Kop-lengte wijkt af: {len(kop)} tekens (richtlijn 100–150)."))
    # intro 200-220
    if not (200 <= len(intro) <= 220):
        warnings.append(("W006", f"Intro-lengte wijkt af: {len(intro)} tekens (richtlijn 200–220)."))

    # XS vs S selection heuristic based on source length
    target = "XS" if source_len < 2500 else "S"
    total = len(intro) + len(body)
    if target == "XS":
        lo, hi = 950, 1150
    else:
        lo, hi = 1750, 1950

    # allow +10% over
    hi_soft = int(hi * 1.10)

    if total < lo:
        warnings.append(("W007", f"Tekst mogelijk te kort voor {target}: {total} tekens (doel {lo}–{hi})."))
    elif total > hi_soft:
        warnings.append(("W007", f"Tekst mogelijk te lang voor {target}: {total} tekens (doel {lo}–{hi}, max {hi_soft})."))
