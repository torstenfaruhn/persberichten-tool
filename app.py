\
from __future__ import annotations
import io, os, re, json, time, tempfile
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple

import requests
from flask import Flask, jsonify, render_template, request, send_file
from docx import Document
from PyPDF2 import PdfReader

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PROCESS_SECONDS = 360

LLM_MODE = os.getenv("LLM_MODE", "on").lower() == "on"
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_BYTES

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "frame-ancestors 'none'; "
    "form-action 'self'; "
    "upgrade-insecure-requests"
)

@app.after_request
def add_headers(resp):
    resp.headers["Content-Security-Policy"] = CSP
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    resp.headers["Cache-Control"] = "no-store"
    return resp

@dataclass
class Signal:
    code: str
    message: str
    severity: str  # error|warning|info

@dataclass
class ProcessResult:
    ok: bool
    signals: List[Signal]
    output_txt: Optional[str] = None
    cleaned_source: Optional[str] = None
    tech_log: Optional[str] = None

def tech(code: str, msg: str) -> str:
    return f"{int(time.time())}\t{code}\t{msg}"

def normalize_ws(s: str) -> str:
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = "\n".join([ln.rstrip() for ln in s.split("\n")])
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

def extract_txt(b: bytes) -> str:
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("latin-1", errors="replace")

def extract_docx(b: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=True) as tmp:
        tmp.write(b); tmp.flush()
        doc = Document(tmp.name)
        parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
        return "\n\n".join(parts)

def extract_pdf(b: bytes) -> Tuple[str, int]:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
        tmp.write(b); tmp.flush()
        reader = PdfReader(tmp.name)
        txt = []
        for p in reader.pages:
            t = p.extract_text() or ""
            if t: txt.append(t)
        full = normalize_ws("\n\n".join(txt))
        return full, len(full)

def detect_contact_tail(text: str) -> Optional[str]:
    lines = text.splitlines()
    tail = "\n".join(lines[-60:])
    if re.search(r"@[A-Za-z0-9._%+-]+\.[A-Za-z]{2,}", tail) or re.search(r"\b(Tel\.?|Telefoon|Contact|Voor meer informatie|Noot voor de redactie)\b", tail, re.I):
        return tail.strip()
    return None

def strong_claims(text: str) -> bool:
    return bool(re.search(r"\b(uniek|beste|veiligst|revolutionair|nummer\s*1)\b", text, re.I))

def relative_time(text: str) -> bool:
    return bool(re.search(r"\b(gisteren|vandaag|morgen|vanavond|vanochtend|gisteravond)\b", text, re.I))

def split_sections(text: str) -> List[str]:
    chunks = re.split(r"\n\s*(?:—{3,}|\*{3,}|EINDE PERSBERICHT)\s*\n", text, flags=re.I)
    return [c.strip() for c in chunks if c.strip()]

def score_second(section: str) -> int:
    score = 0
    if re.search(r"^[A-ZÀ-ÿ][A-Za-zÀ-ÿ .'-]{2,40},\s*\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+\d{4}\s*[–-]", section, re.M):
        score += 2
    start = section[:500]
    if len([s for s in re.split(r"[.!?]\s+", start) if s.strip()]) >= 2:
        score += 2
    first_lines = [ln.strip() for ln in section.splitlines() if ln.strip()][:6]
    if first_lines and len(first_lines[0]) <= 160:
        score += 1
    if re.search(r"\b(Contact|Voor meer informatie|Noot voor de redactie|Woordvoerder)\b", section, re.I):
        score += 1
    return score

def multiple_press_release(text: str) -> Tuple[Optional[Signal], Optional[Signal]]:
    sections = split_sections(text)
    if len(sections) <= 1:
        return None, None
    second = sections[1]
    score = score_second(second)
    if score >= 4 and len(second) >= 900:
        return Signal("E007","Meerdere persberichten in één document gevonden. Lever per document één persbericht aan dat door deze tool wordt verwerkt.","error"), None
    if score in (2,3):
        return None, Signal("W015","Mogelijk tweede persbericht in document gevonden. Controleer of het document echt maar één persbericht bevat.","warning")
    return None, None

def neutralize(text: str) -> str:
    reps = [
        (r"\bwereldleider\b","grote speler"),
        (r"\bmarktleider\b","grote speler"),
        (r"\binnovatief\b","nieuw"),
        (r"\brevolutionair\b","nieuw"),
        (r"\buniek\b","bijzonder"),
    ]
    out = text
    for a,b in reps:
        out = re.sub(a,b,out,flags=re.I)
    return out

def structure(text: str) -> Tuple[str,str,str]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines: return "","",""
    kop = lines[0][:150].rstrip()
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) == 1:
        intro = paras[0][:650].strip()
        body = paras[0][len(intro):].strip()
    else:
        intro = paras[1][:650].strip() if paras[0].startswith(kop) and len(paras)>1 else paras[0][:650].strip()
        body = "\n\n".join(paras[2:] if paras[0].startswith(kop) and len(paras)>2 else paras[1:]).strip()
    return kop,intro,body

def find_5w(text: str) -> Dict[str,bool]:
    t = text.lower()
    who = bool(re.search(r"\b(organisatie|bedrijf|stichting|vereniging|gemeente|politie|universiteit)\b", t)) or bool(re.search(r"\b[A-ZÀ-ÿ][a-zà-ÿ]+ [A-ZÀ-ÿ][a-zà-ÿ]+\b", text))
    what = bool(re.search(r"\b(opent|start|lanceert|introduceert|organiseert|houdt|presenteert|maakt bekend|meldt|sluit|bouwt)\b", t))
    where = bool(re.search(r"\b(Maastricht|Heerlen|Sittard|Roermond|Venlo|Weert|Kerkrade|Valkenburg|Geleen|Landgraaf|Echt|Susteren)\b", text)) or bool(re.search(r"\b(in|op|bij)\b", t))
    when = bool(re.search(r"\b\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+\d{4}\b", text)) or bool(re.search(r"\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b", t))
    why = bool(re.search(r"\b(omdat|zodat|vanwege|met als doel)\b", t))
    how = bool(re.search(r"\b(door|via|met behulp van|op deze manier)\b", t))
    return {"Wie":who,"Wat":what,"Waar":where,"Wanneer":when,"Waarom":why,"Hoe":how}

def llm_rewrite(api_key: str, src: str) -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type":"application/json"}
    sys = ("Je herschrijft een persbericht naar een neutraal nieuwsconcept in B1. "
           "Neem alleen controleerbare feiten uit de bron over. Verzín niets. "
           "Output in vaste velden: KOP, INTRO, BODY.")
    payload = {"model": OPENAI_MODEL, "messages":[{"role":"system","content":sys},{"role":"user","content":src}], "temperature":0.2}
    url = f"{OPENAI_BASE_URL.rstrip('/')}/chat/completions"
    r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=60)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

def parse_field(s: str, label: str) -> str:
    i = s.find(label)
    if i == -1: return ""
    rest = s[i+len(label):]
    for nxt in ["KOP:","INTRO:","BODY:","SIGNALEN:","BRON:"]:
        if nxt == label: continue
        j = rest.find(nxt)
        if j != -1:
            rest = rest[:j]; break
    return rest.strip()

def output_txt(kop: str, intro: str, body: str, signals: List[Signal]) -> str:
    sig = "\\n".join([f"- {s.code}: {s.message}" for s in signals]) or "- (geen signalen)"
    return f"KOP:\\n{kop}\\n\\nINTRO:\\n{intro}\\n\\nBODY:\\n{body}\\n\\nSIGNALEN:\\n{sig}\\n\\nBRON:\\nBron: aangeleverd persbericht\\n"

@app.get("/")
def index():
    return render_template("index.html")

@app.post("/api/process")
def process():
    api_key = (request.form.get("apiKey") or "").strip()
    if not api_key:
        return jsonify(_res(ProcessResult(False,[Signal("E000","API-key is vereist om verder te gaan.","error")],tech_log=tech("E000","missing_api_key")))), 400

    if "file" not in request.files:
        return jsonify(_res(ProcessResult(False,[Signal("E002","Onleesbaar bestand. Upload een ander bestand.","error")],tech_log=tech("E002","missing_file")))), 400

    f = request.files["file"]
    name = (f.filename or "").lower()
    data = f.read()

    if len(data) > MAX_FILE_BYTES:
        return jsonify(_res(ProcessResult(False,[Signal("E001","Bestand te groot (>10MB).","error")],tech_log=tech("E001","file_too_large")))), 400

    try:
        if name.endswith(".txt"):
            raw = extract_txt(data); extractable = len(raw)
        elif name.endswith(".docx"):
            raw = extract_docx(data); extractable = len(raw)
        elif name.endswith(".pdf"):
            raw, extractable = extract_pdf(data)
        else:
            raise ValueError("unsupported")
    except Exception:
        return jsonify(_res(ProcessResult(False,[Signal("E002","Onleesbaar bestand. Upload een ander bestand.","error")],tech_log=tech("E002","extract_failed")))), 400

    cleaned = normalize_ws(raw)

    if name.endswith(".pdf") and extractable < 800:
        return jsonify(_res(ProcessResult(False,[Signal("E003","Te weinig bruikbare brontekst. Upload een ander bestand.","error")],cleaned_source=cleaned,tech_log=tech("E003","pdf_low_text")))), 400

    if len(cleaned) < 950:
        return jsonify(_res(ProcessResult(False,[Signal("E004","Te weinig brontekst om nieuwsbericht te genereren.","error")],cleaned_source=cleaned,tech_log=tech("E004","text_too_short")))), 400

    e007, w015 = multiple_press_release(cleaned)
    if e007:
        return jsonify(_res(ProcessResult(False,[e007],cleaned_source=cleaned,tech_log=tech("E007","multiple_press_releases")))), 400

    signals: List[Signal] = []
    if w015: signals.append(w015)
    if strong_claims(cleaned):
        signals.append(Signal("W004","Sterke claim aangetroffen. Controleer neutraliteit.","warning"))
    if relative_time(cleaned):
        signals.append(Signal("W008","Extern verifiëren: tijdsaanduiding is relatief (bijv. gisteren/morgen). Maak dit absoluut.","warning"))

    w = find_5w(cleaned)
    missing_five = [k for k in ("Wie","Wat","Waar","Wanneer","Waarom") if not w.get(k)]
    if len(missing_five) >= 2:
        return jsonify(_res(ProcessResult(False,[Signal("E006","Brontekst voldoet niet aan minimumeisen: 5W’s+H.","error")],cleaned_source=cleaned,tech_log=tech("E006","5w_minimum_not_met")))), 400

    if not w["Wie"]: signals.append(Signal("W011","Wie ontbreekt of is onduidelijk.","warning"))
    if not w["Wat"]: signals.append(Signal("W012","Wat ontbreekt of is onduidelijk.","warning"))
    if not w["Waar"]: signals.append(Signal("W013","Waar ontbreekt of is onduidelijk.","warning"))
    if not w["Wanneer"]: signals.append(Signal("W014","Wanneer ontbreekt of is onduidelijk.","warning"))
    if not w["Waarom"]: signals.append(Signal("W001","Waarom ontbreekt.","warning"))
    if not w["Hoe"]: signals.append(Signal("W002","Hoe ontbreekt.","warning"))

    contact = detect_contact_tail(cleaned)
    if contact:
        signals.append(Signal("W009","Contactinformatie gevonden. Neem dit niet over in publicatie; zet in apart contactblok.","warning"))

    src = neutralize(cleaned)
    kop=intro=body=""
    if LLM_MODE:
        try:
            llm = llm_rewrite(api_key, src)
            kop = parse_field(llm,"KOP:")
            intro = parse_field(llm,"INTRO:")
            body = parse_field(llm,"BODY:")
            if not (kop and intro and body):
                kop,intro,body = structure(src)
        except Exception:
            signals.append(Signal("W010","Technisch probleem bij herschrijven. Probeer opnieuw of gebruik ‘Document bewerken’.","warning"))
            kop,intro,body = structure(src)
    else:
        kop,intro,body = structure(src)

    if len(kop) < 100: signals.append(Signal("W005","Kop is korter dan 100 tekens.","warning"))
    if len(kop) > 150: signals.append(Signal("W006","Kop is langer dan 150 tekens.","warning"))

    contact_block = f"\\n\\nCONTACT (niet voor publicatie):\\n{contact.strip()}" if contact else ""
    out = output_txt(kop,intro,body+contact_block,signals)
    return jsonify(_res(ProcessResult(True,signals,output_txt=out,cleaned_source=cleaned,tech_log=tech("OK","processed"))))

@app.post("/api/reprocess")
def reprocess():
    payload = request.get_json(force=True, silent=True) or {}
    api_key = (payload.get("apiKey") or "").strip()
    edited = payload.get("text") or ""
    if not api_key:
        return jsonify(_res(ProcessResult(False,[Signal("E000","API-key is vereist om verder te gaan.","error")],tech_log=tech("E000","missing_api_key")))), 400

    cleaned = normalize_ws(edited)
    if len(cleaned) < 950:
        return jsonify(_res(ProcessResult(False,[Signal("E004","Te weinig brontekst om nieuwsbericht te genereren.","error")],cleaned_source=cleaned,tech_log=tech("E004","text_too_short")))), 400

    e007, w015 = multiple_press_release(cleaned)
    if e007:
        return jsonify(_res(ProcessResult(False,[e007],cleaned_source=cleaned,tech_log=tech("E007","multiple_press_releases")))), 400

    signals: List[Signal] = []
    if w015: signals.append(w015)
    if strong_claims(cleaned): signals.append(Signal("W004","Sterke claim aangetroffen. Controleer neutraliteit.","warning"))
    if relative_time(cleaned): signals.append(Signal("W008","Extern verifiëren: tijdsaanduiding is relatief (bijv. gisteren/morgen). Maak dit absoluut.","warning"))

    w = find_5w(cleaned)
    missing_five = [k for k in ("Wie","Wat","Waar","Wanneer","Waarom") if not w.get(k)]
    if len(missing_five) >= 2:
        return jsonify(_res(ProcessResult(False,[Signal("E006","Brontekst voldoet niet aan minimumeisen: 5W’s+H.","error")],cleaned_source=cleaned,tech_log=tech("E006","5w_minimum_not_met")))), 400

    if not w["Wie"]: signals.append(Signal("W011","Wie ontbreekt of is onduidelijk.","warning"))
    if not w["Wat"]: signals.append(Signal("W012","Wat ontbreekt of is onduidelijk.","warning"))
    if not w["Waar"]: signals.append(Signal("W013","Waar ontbreekt of is onduidelijk.","warning"))
    if not w["Wanneer"]: signals.append(Signal("W014","Wanneer ontbreekt of is onduidelijk.","warning"))
    if not w["Waarom"]: signals.append(Signal("W001","Waarom ontbreekt.","warning"))
    if not w["Hoe"]: signals.append(Signal("W002","Hoe ontbreekt.","warning"))

    contact = detect_contact_tail(cleaned)
    if contact: signals.append(Signal("W009","Contactinformatie gevonden. Neem dit niet over in publicatie; zet in apart contactblok.","warning"))

    src = neutralize(cleaned)
    kop,intro,body = structure(src)
    contact_block = f"\\n\\nCONTACT (niet voor publicatie):\\n{contact.strip()}" if contact else ""
    out = output_txt(kop,intro,body+contact_block,signals)
    return jsonify(_res(ProcessResult(True,signals,output_txt=out,cleaned_source=cleaned,tech_log=tech("OK","reprocessed"))))

@app.post("/api/download")
def download():
    payload = request.get_json(force=True, silent=True) or {}
    content = payload.get("content","")
    bio = io.BytesIO(content.encode("utf-8"))
    return send_file(bio, mimetype="text/plain", as_attachment=True, download_name="nieuwsconcept.txt")

@app.post("/api/download-log")
def download_log():
    payload = request.get_json(force=True, silent=True) or {}
    content = payload.get("content","")
    bio = io.BytesIO(content.encode("utf-8"))
    return send_file(bio, mimetype="text/plain", as_attachment=True, download_name="technisch-log.txt")

def _res(r: ProcessResult) -> Dict:
    return {
        "ok": r.ok,
        "signals": [asdict(s) for s in r.signals],
        "output_txt": r.output_txt,
        "cleaned_source": r.cleaned_source,
        "tech_log": r.tech_log,
        "llm_mode": LLM_MODE,
    }

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT","8080")), debug=False)
