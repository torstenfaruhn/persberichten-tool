import { wordCountChars } from "./wordcount";
import type { Signal } from "./signals";

export type Generated = {
  kop: string;
  intro: string;
  body: string;
  bron: string;
  fiveW: {
    wie?: string;
    wat?: string;
    waar?: string;
    wanneer?: string;
    waarom?: string;
    hoe?: string;
  };
  contactNietVoorPublicatie?: string;
  labels?: string[];
};

export function validateLengths(gen: Generated): Signal[] {
  const signals: Signal[] = [];
  const kopLen = wordCountChars(gen.kop);

  if (kopLen < 100) signals.push({ code: "W005", level: "warning", message: "Kop is korter dan 100 tekens." });
  if (kopLen > 150) signals.push({ code: "W006", level: "warning", message: "Kop is langer dan 150 tekens." });

  // Stijlboek: nieuwskop bevat geen leestekens (mens kiest); tool signaleert altijd.
  if (/[.!?:;,“”\"'’]/.test(gen.kop)) {
    signals.push({ code: "W007", level: "warning", message: "Kop bevat leestekens. Volgens het stijlboek is dat meestal niet gewenst." });
  }

  const introLen = wordCountChars(gen.intro);
  if (introLen < 200 || introLen > 242) {
    signals.push({ code: "W007", level: "warning", message: "Intro valt buiten de gewenste lengte (200–220 tekens, +10% toegestaan)." });
  }

  const total = wordCountChars(gen.intro + " " + gen.body);
  const xsMax = Math.round(1150 * 1.10);
  const sMax = Math.round(1950 * 1.10);
  const inXS = total >= 950 && total <= xsMax;
  const inS = total >= 1750 && total <= sMax;
  if (!inXS && !inS) {
    signals.push({ code: "W007", level: "warning", message: "Lengte van intro + body valt buiten de richtlijnen (XS of S). Controleer en pas aan." });
  }
  return signals;
}

export function validate5W(gen: Generated): { hardError?: Signal; warnings: Signal[] } {
  const warnings: Signal[] = [];
  const w = gen.fiveW ?? {};
  const missingCore = ["wie", "wat", "waar", "wanneer", "waarom"].filter((k) => !String((w as any)[k] ?? "").trim());

  if (missingCore.length >= 2) {
    return { hardError: { code: "E006", level: "error", message: "Brontekst voldoet niet aan minimumeisen: 5W’s+H." }, warnings: [] };
  }

  if (!String(w.wie ?? "").trim()) warnings.push({ code: "W011", level: "warning", message: "Wie ontbreekt in de 5W’s." });
  if (!String(w.wat ?? "").trim()) warnings.push({ code: "W012", level: "warning", message: "Wat ontbreekt in de 5W’s." });
  if (!String(w.waar ?? "").trim()) warnings.push({ code: "W013", level: "warning", message: "Waar ontbreekt in de 5W’s." });
  if (!String(w.wanneer ?? "").trim()) warnings.push({ code: "W014", level: "warning", message: "Wanneer ontbreekt in de 5W’s." });

  if (!String(w.waarom ?? "").trim()) warnings.push({ code: "W001", level: "warning", message: "Waarom ontbreekt." });
  if (!String(w.hoe ?? "").trim()) warnings.push({ code: "W002", level: "warning", message: "Hoe ontbreekt." });

  const when = String(w.wanneer ?? "");
  if (/(gisteren|vandaag)/i.test(when) && !/\b\d{4}\b/.test(when)) {
    warnings.push({ code: "W008", level: "warning", message: "Extern verifiëren. Maak tijdsaanduiding absoluut." });
  }

  return { warnings };
}

export function detectStrongClaims(text: string): Signal[] {
  const signals: Signal[] = [];
  if (/(\buniek\b|\bbeste\b|\bveiligst\b|\brevolutionair\b)/i.test(text)) {
    signals.push({ code: "W004", level: "warning", message: "Sterke claim aangetroffen. Controleer en maak taal neutraal." });
  }
  return signals;
}

export function detectContactInfo(sourceText: string): { signal?: Signal; extracted?: string } {
  const emails = Array.from(sourceText.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)).map((m) => m[0]);
  const phones = Array.from(sourceText.matchAll(/\b\+?\d[\d \-()]{7,}\b/g)).map((m) => m[0]);
  const unique = Array.from(new Set([...emails, ...phones])).slice(0, 10);
  if (unique.length === 0) return {};
  return {
    signal: { code: "W009", level: "warning", message: "Contactinformatie gevonden. Zet deze in een apart contact-blok (niet voor publicatie)." },
    extracted: unique.join("\n"),
  };
}

export function detectCommonStyleMistakes(text: string): Signal[] {
  const signals: Signal[] = [];

  if (/\bteveel\b/i.test(text)) signals.push({ code: "W007", level: "warning", message: "Mogelijke stijlkwestie: 'te veel' is vaak twee woorden." });
  if (/\bhoe\s+lang\b/i.test(text)) signals.push({ code: "W007", level: "warning", message: "Mogelijke stijlkwestie: 'hoelang' is één woord bij duur." });
  if (/\bpolshoogte\b/i.test(text)) signals.push({ code: "W007", level: "warning", message: "Mogelijke stijlkwestie: 'poolshoogte' nemen." });
  if (/\bhoutgreep\b/i.test(text)) signals.push({ code: "W007", level: "warning", message: "Mogelijke stijlkwestie: 'houdgreep'." });
  if (/\bnaar\s+verluid\b/i.test(text)) signals.push({ code: "W007", level: "warning", message: "Mogelijke stijlkwestie: 'naar verluidt'." });

  if (/%/.test(text)) signals.push({ code: "W007", level: "warning", message: "Mogelijke stijlkwestie: schrijf 'procent' voluit in plaats van '%'-teken." });

  if (/\bU\b/.test(text) || /\bUw\b/.test(text)) signals.push({ code: "W007", level: "warning", message: "Mogelijke stijlkwestie: schrijf 'u' en 'uw' met kleine letter." });

  return signals;
}

export function detectNameInconsistency(sourceText: string, outText: string): Signal[] {
  const signals: Signal[] = [];
  const capWords = (t: string) => Array.from(t.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g)).map((m) => m[0]);
  const s = capWords(sourceText);
  const o = capWords(outText);
  const lowerMap = new Map<string, Set<string>>();

  for (const w of [...s, ...o]) {
    const k = w.toLowerCase();
    if (!lowerMap.has(k)) lowerMap.set(k, new Set());
    lowerMap.get(k)!.add(w);
  }
  const inconsistent = Array.from(lowerMap.values()).filter((set) => set.size >= 2);
  if (inconsistent.length > 0) {
    signals.push({ code: "W003", level: "warning", message: "Mogelijke naam-inconsistentie gevonden. Controleer spelling van namen." });
  }
  return signals;
}
