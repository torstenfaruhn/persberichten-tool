import { normalizeForWordCount } from "./wordcount";

export type SecondPressResult = {
  score: number;
  secondSectionChars: number;
  reasons: string[];
};

export function detectSecondPressRelease(raw: string): SecondPressResult {
  const text = normalizeForWordCount(raw);
  const reasons: string[] = [];

  const hardSplit = /(\*\*\*|—{2,}|EINDE\s+PERSBERICHT)/i.test(text);
  let score = 0;
  if (hardSplit) {
    score += 1;
    reasons.push("Harde scheiding gevonden.");
  }

  const datelineRe =
    /(?:^|\s)([A-ZÁÉÍÓÚÄËÏÖÜ][A-Za-zÁÉÍÓÚÄËÏÖÜ\- ]{2,30})\s*,\s*\d{1,2}\s+[a-z]{3,10}\s+\d{4}/gi;
  const datelines = Array.from(text.matchAll(datelineRe)).length;
  if (datelines >= 2) {
    score += 2;
    reasons.push("Meerdere datelines gevonden.");
  }

  const titleLike = /(?:^|\s)([A-Z][^.!?]{20,120})(?=\s)/g.test(text);
  if (titleLike) {
    score += 1;
    reasons.push("Mogelijke titel gevonden.");
  }

  const contactLike =
    /(\b\+?\d[\d \-()]{7,}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i.test(text);
  if (contactLike) {
    score += 1;
    reasons.push("Mogelijk contactblok gevonden.");
  }

  const leadMarkers = /(in\s+het\s+kort|samenvatting|lead)/i.test(text);
  if (leadMarkers) {
    score += 2;
    reasons.push("Marker voor lead/samenvatting gevonden.");
  }

  let second = "";
  if (hardSplit) {
    const parts = text.split(/\*\*\*|—{2,}|EINDE\s+PERSBERICHT/i);
    if (parts.length >= 2) second = parts.slice(1).join(" ").trim();
  } else if (datelines >= 2) {
    const all = Array.from(text.matchAll(datelineRe));
    const secondIdx = all[1]?.index ?? -1;
    if (secondIdx >= 0) second = text.slice(secondIdx).trim();
  }
  const secondSectionChars = second.length;

  return { score, secondSectionChars, reasons };
}
