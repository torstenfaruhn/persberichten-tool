import OpenAI from "openai";
import { z } from "zod";

export const LlmSchema = z.object({
  kop: z.string().min(1),
  intro: z.string().min(1),
  body: z.string().min(1),
  bron: z.string().min(1),
  fiveW: z.object({
    wie: z.string().optional(),
    wat: z.string().optional(),
    waar: z.string().optional(),
    wanneer: z.string().optional(),
    waarom: z.string().optional(),
    hoe: z.string().optional(),
  }),
  contactNietVoorPublicatie: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

export type LlmOut = z.infer<typeof LlmSchema>;

export function makeClient(apiKey: string) {
  return new OpenAI({ apiKey });
}

export function buildSystemPrompt(): string {
  return [
    "Je herschrijft een persbericht naar een conceptnieuwsbericht in Nederlands B1.",
    "Schrijf zakelijk en feitelijk. Geen reclame- of marketingstijl. Geen superlatieven.",
    "Neem alleen feiten over die in de bron staan. Verzín niets. Geen sfeerbeschrijvingen.",
    "Citaten letterlijk overnemen en duidelijk toeschrijven.",
    "Niet-citaten altijd attribueren: 'volgens het persbericht/het bedrijf/de woordvoerder'.",
    "Structuur: kop, intro, body, bron. Intro bevat minimaal Wie, Wat, Waar, Wanneer.",
    "Body rolt af: belangrijkste info eerst, details later, rond af met slot.",
    "5W+H teruggeven als velden. Waarom en Hoe alleen als letterlijk in de bron aanwezig.",
    "Nooit informatie uit 'niet voor publicatie', boilerplate of noot voor de redactie opnemen in kop/intro/body.",
    "Als contactinformatie wordt gevonden, zet dat in 'contactNietVoorPublicatie'.",
    "Geef output als één JSON-object met velden: kop,intro,body,bron,fiveW,contactNietVoorPublicatie,labels.",
  ].join("\n");
}

export function buildUserPrompt(cleanedSource: string): string {
  return ["BRONTEKST (persbericht):", cleanedSource].join("\n\n");
}

export async function runLlm(apiKey: string, cleanedSource: string, timeoutMs: number): Promise<LlmOut> {
  const client = makeClient(apiKey);

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(cleanedSource) },
        ],
      },
      { signal: ac.signal as any }
    );

    const content = res.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content);
    return LlmSchema.parse(parsed);
  } finally {
    clearTimeout(t);
  }
}
