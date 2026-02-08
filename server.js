import express from "express";
import helmet from "helmet";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Security headers (no tracking, no third-party scripts) ----
const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'none'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  formAction: ["'self'"],
  imgSrc: ["'self'", "data:"],
  styleSrc: ["'self'"],
  scriptSrc: ["'self'"],
  connectSrc: ["'self'"]
};

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  crossOriginEmbedderPolicy: false // keep simple for pdf/docx parsing responses
}));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.static(path.join(process.cwd(), "public"), {
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-store");
  }
}));

// ---- Upload handling (temp to /tmp, max 10MB) ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

function nowIso() { return new Date().toISOString(); }

function makeRequestId() {
  return crypto.randomBytes(8).toString("hex");
}

function safeTechLog({ requestId, status, code, detail, fileMeta, durationMs }) {
  // IMPORTANT: never include article text or personal data
  return {
    requestId,
    ts: nowIso(),
    status,
    code,
    detail: detail ? String(detail).slice(0, 200) : undefined,
    file: fileMeta,
    durationMs
  };
}

function wordTellingCount(text) {
  // Word-telling: characters including spaces, without newlines, normalize double spaces.
  const normalized = text.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length;
}

function normalizeTextForModel(text) {
  return text.replace(/\r?\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanForCounting(text) {
  return text.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function detectContactInfo(rawText) {
  const emails = Array.from(rawText.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)).map(m => m[0]);
  const phones = Array.from(rawText.matchAll(/(\+31|0)\s?\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/g)).map(m => m[0]);
  // de-dup
  const uniq = (arr) => [...new Set(arr.map(s => s.trim()))].filter(Boolean);
  return { emails: uniq(emails), phones: uniq(phones) };
}

function detectStrongClaims(rawText) {
  const triggers = ["uniek", "beste", "veiligst", "revolutionair", "nummer 1", "toonaangevend", "wereldprimeur", "baanbrekend"];
  const lowered = rawText.toLowerCase();
  const found = triggers.filter(t => lowered.includes(t));
  return [...new Set(found)];
}

function monthNamesNl() {
  return ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
}

function detectMultiplePressReleases(rawText) {
  // Heuristic score model per prompt. We use raw text with line breaks preserved.
  const text = rawText.replace(/\r\n/g, "\n");
  const scoreParts = [];

  // +1 hard separation
  const hardSep = /(^|\n)\s*(—{2,}|-{3,}|\*{3,}|EINDE PERSBERICHT)\s*(\n|$)/im;
  if (hardSep.test(text)) scoreParts.push({ name: "hardSep", points: 1 });

  // +1 new contact block/afzender
  const contactLike = /(pers|voor)\s*de\s*redactie|contact|voor\s*meer\s*informatie|media(contact)?/i;
  const contactHits = (text.match(contactLike) || []).length;
  if (contactHits >= 2) scoreParts.push({ name: "contactBlocks", points: 1 });

  // +1 clear title / heading-like repeated
  const headingHits = (text.match(/(^|\n)\s*(PERSBERICHT|PERSMEDEDELING)\b/gi) || []).length;
  if (headingHits >= 2) scoreParts.push({ name: "pressHeadings", points: 1 });

  // +2 new dateline (place + date)
  const months = monthNamesNl().join("|");
  const datelineRe = new RegExp(`(^|\\n)\\s*[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÿ'\\- ]{2,},?\\s+\\d{1,2}\\s+(${months})\\s+\\d{4}\\b`, "gmi");
  const datelineHits = Array.from(text.matchAll(datelineRe)).length;
  if (datelineHits >= 2) scoreParts.push({ name: "datelines", points: 2 });

  // +2 new lead: look for multiple short paragraph intros right after headings or datelines
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const leadLike = paragraphs.filter(p => p.length >= 100 && p.length <= 450 && /[.!?]/.test(p)).length;
  if (leadLike >= 3) scoreParts.push({ name: "leadLikeParas", points: 2 });

  const score = scoreParts.reduce((s, x) => s + x.points, 0);

  // Second section length check: split by hard separator and/or repeated headings
  let sections = text.split(hardSep);
  sections = sections.map(s => (s || "").trim()).filter(s => s.length > 0);
  const secondLen = sections.length >= 2 ? cleanForCounting(sections[1]).length : 0;

  return { score, scoreParts, secondSectionCharLen: secondLen };
}

async function extractTextFromFile(buffer, originalname, mimetype) {
  const lower = (originalname || "").toLowerCase();
  if (mimetype === "text/plain" || lower.endsWith(".txt")) {
    return buffer.toString("utf8");
  }
  if (lower.endsWith(".docx") || mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }
  if (lower.endsWith(".pdf") || mimetype === "application/pdf") {
    const data = await pdfParse(buffer);
    return data.text || "";
  }
  // Try utf8 as last resort
  return buffer.toString("utf8");
}

function buildSystemPrompt() {
  // Keep short, focus on constraints. Stylebook rules have priority.
  return [
    "Je bent een redactietool. Output moet journalistiek en neutraal zijn, B1-taal.",
    "Gebruik alleen feiten uit de bron. Verzin niets. Geen sfeer/meningen. Geen superlatieven/marketing.",
    "Altijd oprolbaar: kop, intro, body met afnemende belangrijkheid, afgerond slot.",
    "Intro bevat minimaal Wie, Wat, Waar en Wanneer als aanwezig in bron.",
    "Tijdsaanduidingen absoluut: geen gisteren/morgen; gebruik dag/datum als in bron. Als alleen gisteren/vandaag en geen datum: zet signaal (extern verifiëren).",
    "Citaten: gesproken woorden tussen dubbele aanhalingstekens; geschreven woorden tussen enkele. In kop: citaten tussen enkele.",
    "Getallen: tot en met twintig in letters; leeftijden/bedragen/maten/gewichten/afstanden in cijfers. Gebruik geen €-teken; schrijf euro voluit.",
    "Attribueer informatie aan het persbericht (bijv. 'volgens het persbericht' of 'volgens de woordvoerder').",
    "Neem niets uit boilerplate/niet-voor-publicatie/contactdeel op in kop/intro/body.",
    "Geef output als JSON volgens schema."
  ].join("\n");
}

function buildUserPrompt({ rawText, targets }) {
  return [
    "Brontekst (persbericht):",
    rawText,
    "",
    "Taken:",
    "1) Extraheer 5W+H als velden (wie, wat, waar, wanneer, waarom, hoe). Laat leeg als niet letterlijk aanwezig.",
    "2) Schrijf een conceptnieuwsbericht met kop/intro/body volgens lengtes.",
    `- Kop: 100-150 tekens (soft).`,
    `- Intro: 200-220 tekens.`,
    `- Totaal (intro+body): doel ${targets.totalTarget} tekens, range ${targets.totalMin}-${targets.totalMax}, max +10% boven ${targets.totalMax}.`,
    "3) Maak een korte lijst SIGNALEN (B1), met codes waar passend (W001..W015).",
    "4) Maak een apart contactblok (niet voor publicatie) met gevonden contactinfo uit bron (mail/telefoon/naam).",
    "",
    "JSON schema (geen extra tekst):",
    JSON.stringify({
      wie: "", wat: "", waar: "", wanneer: "", waarom: "", hoe: "",
      kop: "", intro: "", body: "",
      bron: "",
      signalen: [],
      contact: { items: [] }
    }, null, 2)
  ].join("\n");
}

function chooseTargets(cleanLen) {
  // XS/S only if >800 after cleaning per prompt.
  // XS range 950-1150 target 1000; S range 1750-1950 target 1800
  if (cleanLen > 800 && cleanLen <= 1600) {
    return { label: "XS", totalTarget: 1000, totalMin: 950, totalMax: 1150 };
  }
  return { label: "S", totalTarget: 1800, totalMin: 1750, totalMax: 1950 };
}

async function callLLM({ apiKey, rawText, targets, timeoutMs }) {
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/,"");
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const url = `${baseUrl}/chat/completions`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt({ rawText, targets }) }
    ],
    response_format: { type: "json_object" }
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM: lege response");
    return JSON.parse(content);
  } finally {
    clearTimeout(t);
  }
}

function hasHeadlinePunctuation(headline) {
  return /[.,;:!?()"“”]/.test(headline || "");
}

function buildOutputTxt({ json, warnings, errors, extraSignalen, contactInfo }) {
  const lines = [];
  lines.push("KOP:");
  lines.push((json.kop || "").trim());
  lines.push("");
  lines.push("INTRO:");
  lines.push((json.intro || "").trim());
  lines.push("");
  lines.push("BODY:");
  lines.push((json.body || "").trim());
  lines.push("");
  lines.push("BRON:");
  lines.push((json.bron || "Volgens het persbericht.").trim());
  lines.push("");
  lines.push("SIGNALEN:");
  const sig = [];
  for (const s of (json.signalen || [])) sig.push(String(s).trim());
  for (const s of extraSignalen) sig.push(String(s).trim());
  // ensure warnings listed
  for (const w of warnings) {
    if (!sig.some(x => x.includes(w))) sig.push(`${w}: zie signaal.`);
  }
  if (sig.length === 0) sig.push("Geen meldingen.");
  for (const s of sig.filter(Boolean)) lines.push(`- ${s}`);
  lines.push("");

  const contactItems = [];
  if (Array.isArray(json?.contact?.items)) contactItems.push(...json.contact.items.map(String));
  if (contactInfo?.emails?.length) contactItems.push(...contactInfo.emails.map(e => `E-mail: ${e}`));
  if (contactInfo?.phones?.length) contactItems.push(...contactInfo.phones.map(p => `Telefoon: ${p}`));

  if (contactItems.length) {
    lines.push("CONTACT (NIET VOOR PUBLICATIE):");
    for (const c of [...new Set(contactItems.map(s => s.trim()))].filter(Boolean)) lines.push(`- ${c}`);
    lines.push("");
  }

  return lines.join("\n");
}

app.post("/api/process", upload.single("file"), async (req, res) => {
  const requestId = makeRequestId();
  const start = Date.now();

  const apiKey = (req.body?.apiKey || "").trim();
  if (!apiKey) {
    const log = safeTechLog({ requestId, status: "error", code: "E002", detail: "API-key ontbreekt", fileMeta: undefined, durationMs: Date.now() - start });
    return res.status(400).json({
      status: "error",
      errorCode: "E002",
      signalen: ["API-key is vereist om verder te gaan."],
      techLog: log
    });
  }

  const file = req.file;
  if (!file) {
    const log = safeTechLog({ requestId, status: "error", code: "E002", detail: "Geen bestand", fileMeta: undefined, durationMs: Date.now() - start });
    return res.status(400).json({
      status: "error",
      errorCode: "E002",
      signalen: ["E002: Onleesbaar bestand. Upload een nieuw document."],
      techLog: log
    });
  }

  const fileMeta = { name: file.originalname, type: file.mimetype, size: file.size };

  // E001 handled by multer limit error handler; but double guard:
  if (file.size > 10 * 1024 * 1024) {
    const log = safeTechLog({ requestId, status: "error", code: "E001", detail: "Bestand > 10MB", fileMeta, durationMs: Date.now() - start });
    return res.status(413).json({
      status: "error",
      errorCode: "E001",
      signalen: ["E001: Bestand te groot (>10MB). Upload een kleiner bestand."],
      techLog: log
    });
  }

  let extracted = "";
  try {
    extracted = await extractTextFromFile(file.buffer, file.originalname, file.mimetype);
  } catch (e) {
    const log = safeTechLog({ requestId, status: "error", code: "E002", detail: e?.message || e, fileMeta, durationMs: Date.now() - start });
    return res.status(400).json({
      status: "error",
      errorCode: "E002",
      signalen: ["E002: Onleesbaar bestand. Probeer een nieuw export-bestand (bijv. opnieuw opslaan als .docx of .pdf)."],
      techLog: log
    });
  }

  const normalized = normalizeTextForModel(extracted);
  const cleanCount = wordTellingCount(extracted);

  // PDF scan detection
  const isPdf = (file.originalname || "").toLowerCase().endsWith(".pdf") || file.mimetype === "application/pdf";
  if (isPdf && cleanCount < 800) {
    const log = safeTechLog({ requestId, status: "error", code: "E003", detail: "PDF <800 extracteerbare tekens", fileMeta, durationMs: Date.now() - start });
    return res.status(200).json({
      status: "error",
      errorCode: "E003",
      signalen: ["E003: Te weinig bruikbare brontekst. Upload een ander bestand."],
      techLog: log
    });
  }

  // Too short
  if (cleanCount < 950) {
    const log = safeTechLog({ requestId, status: "error", code: "E004", detail: `Tekst te kort (${cleanCount})`, fileMeta, durationMs: Date.now() - start });
    return res.status(200).json({
      status: "error",
      errorCode: "E004",
      signalen: ["E004: Te weinig brontekst om nieuwsbericht te genereren."],
      techLog: log
    });
  }

  // Multi press release detection
  const multi = detectMultiplePressReleases(extracted);
  const extraSignalen = [];
  const warnings = [];
  if (multi.score >= 4 && multi.secondSectionCharLen >= 900) {
    const log = safeTechLog({ requestId, status: "error", code: "E007", detail: `Score ${multi.score}, tweede sectie ${multi.secondSectionCharLen}`, fileMeta, durationMs: Date.now() - start });
    return res.status(200).json({
      status: "error",
      errorCode: "E007",
      signalen: ["E007: Meerdere persberichten in één document gevonden. Upload 1 persbericht per keer."],
      techLog: log
    });
  } else if (multi.score >= 2) {
    warnings.push("W015");
    extraSignalen.push("W015: Mogelijk tweede persbericht in document gevonden. Controleer of dit document uit 1 persbericht bestaat.");
  }

  // Contact info detection
  const contactInfo = detectContactInfo(extracted);
  if ((contactInfo.emails.length + contactInfo.phones.length) > 0) {
    warnings.push("W009");
    extraSignalen.push("W009: Contactinformatie gevonden. Zet dit niet in kop/intro/body. Zie contactblok (niet voor publicatie).");
  }

  // Strong claims detection
  const strongClaims = detectStrongClaims(extracted);
  if (strongClaims.length) {
    warnings.push("W004");
    extraSignalen.push(`W004: Sterke claim aangetroffen (${strongClaims.join(", ")}). Formuleer neutraal en controleer de claim.`);
  }

  // Always recommend external verify if there are numbers/dates/citations markers
  const hasNumbersOrDates = /\b\d{1,4}\b/.test(extracted);
  if (hasNumbersOrDates) {
    warnings.push("W008");
    extraSignalen.push("W008: Extern verifiëren. Controleer namen, data, cijfers en citaten.");
  }

  // Targets (XS/S)
  const targets = chooseTargets(cleanCount);

  // LLM timeout: keep buffer under 360s total
  const timeoutMs = Math.max(5_000, 330_000); // 330s for LLM call, rest for parsing
  let jsonOut;
  try {
    jsonOut = await callLLM({ apiKey, rawText: normalized, targets, timeoutMs });
  } catch (e) {
    const isTimeout = String(e?.name || "").includes("Abort") || String(e?.message || "").toLowerCase().includes("abort");
    const code = isTimeout ? "E005" : "E002";
    const msg = isTimeout
      ? "E005: Maximale verwerkingstijd overschreden. Herstart de tool (Ctrl+F5) en probeer het opnieuw."
      : "E002: Onleesbaar bestand of verwerking mislukt. Probeer een nieuw export-bestand.";
    const log = safeTechLog({ requestId, status: "error", code, detail: e?.message || e, fileMeta, durationMs: Date.now() - start });
    return res.status(200).json({
      status: "error",
      errorCode: code,
      signalen: [msg, "W010: Technisch probleem tijdens verwerking. Probeer: opnieuw opslaan als .docx of .pdf en upload opnieuw."],
      techLog: log
    });
  }

  // Validate 5W
  const fiveWs = ["wie","wat","waar","wanneer","waarom"];
  const missing = fiveWs.filter(k => !String(jsonOut?.[k] || "").trim());
  if (missing.length >= 2) {
    const log = safeTechLog({ requestId, status: "error", code: "E006", detail: `Ontbrekend: ${missing.join(",")}`, fileMeta, durationMs: Date.now() - start });
    return res.status(200).json({
      status: "error",
      errorCode: "E006",
      signalen: ["E006: Brontekst voldoet niet aan minimumeisen: 5W’s+H."],
      techLog: log
    });
  }

  // W001/W002 if missing why/how
  if (!String(jsonOut?.waarom || "").trim()) {
    warnings.push("W001");
    extraSignalen.push("W001: Waarom ontbreekt. Voeg alleen toe als het letterlijk in de bron staat.");
  }
  if (!String(jsonOut?.hoe || "").trim()) {
    warnings.push("W002");
    extraSignalen.push("W002: Hoe ontbreekt. Voeg alleen toe als het letterlijk in de bron staat.");
  }

  // W011..W014 if individual required Ws missing (soft warnings)
  const mapW = { wie:"W011", wat:"W012", waar:"W013", wanneer:"W014" };
  for (const k of ["wie","wat","waar","wanneer"]) {
    if (!String(jsonOut?.[k] || "").trim()) {
      warnings.push(mapW[k]);
      extraSignalen.push(`${mapW[k]}: 5W niet haalbaar: ${k} ontbreekt.`);
    }
  }

  // Headline length/punctuation warnings
  const kop = String(jsonOut?.kop || "").trim();
  const kopLen = wordTellingCount(kop);
  if (kopLen < 100) {
    warnings.push("W005");
    extraSignalen.push("W005: Kop te kort (<100 tekens).");
  }
  if (kopLen > 150) {
    warnings.push("W006");
    extraSignalen.push("W006: Kop te lang (>150 tekens).");
  }
  if (hasHeadlinePunctuation(kop)) {
    extraSignalen.push("Let op: kop bevat leestekens. Stijlboek: geen leestekens in kop. Mens kiest.");
  }

  // Length warnings for intro/body total range +10%
  const intro = String(jsonOut?.intro || "").trim();
  const body = String(jsonOut?.body || "").trim();
  const introLen = wordTellingCount(intro);
  const bodyLen = wordTellingCount(body);
  const totalLen = introLen + bodyLen;
  const maxAllowed = Math.floor(targets.totalMax * 1.10);
  if (introLen > 220 || introLen < 200 || totalLen > maxAllowed) {
    warnings.push("W007");
    extraSignalen.push("W007: Lengte overschrijding kop/intro/body (soft limieten). Controleer en pas handmatig aan.");
  }
  if (totalLen < 950) {
    // Inhoudelijke afkeur na bewerking
    const log = safeTechLog({ requestId, status: "error", code: "E004", detail: `Na bewerking te kort (${totalLen})`, fileMeta, durationMs: Date.now() - start });
    return res.status(200).json({
      status: "error",
      errorCode: "E004",
      signalen: ["E004: Te weinig brontekst om nieuwsbericht te genereren."],
      techLog: log
    });
  }

  // Absolute time check: if output still uses gisteren/vandaag
  if (/\b(gisteren|vandaag|morgen)\b/i.test(intro + " " + body)) {
    warnings.push("W008");
    extraSignalen.push("W008: Maak tijdsaanduiding absoluut (bijv. dinsdag of 12 januari 2026) als dat in de bron staat. Anders: extern verifiëren.");
  }

  // Name inconsistency: simple heuristic: same word with different casing? skip; too risky.
  // Build output
  const outputTxt = buildOutputTxt({ json: jsonOut, warnings: [...new Set(warnings)], errors: [], extraSignalen, contactInfo });
  const durationMs = Date.now() - start;

  const techLog = safeTechLog({
    requestId,
    status: "ok",
    code: "OK",
    detail: undefined,
    fileMeta,
    durationMs
  });

  return res.status(200).json({
    status: "ok",
    warnings: [...new Set(warnings)],
    signalen: (jsonOut.signalen || []).concat(extraSignalen),
    outputTxt,
    techLog
  });
});

// Multer error handler for E001
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    const requestId = makeRequestId();
    const log = safeTechLog({ requestId, status: "error", code: "E001", detail: "LIMIT_FILE_SIZE", fileMeta: undefined, durationMs: 0 });
    return res.status(413).json({
      status: "error",
      errorCode: "E001",
      signalen: ["E001: Bestand te groot (>10MB). Upload een kleiner bestand."],
      techLog: log
    });
  }
  return next(err);
});

app.listen(PORT, () => {
  console.log(`VIA Persberichten-tool draait op poort ${PORT}`);
});
