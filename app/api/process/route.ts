import { NextResponse } from "next/server";
import fs from "node:fs/promises";

import { getJob, tmpPath } from "@/lib/jobs";
import type { Signal } from "@/lib/signals";
import { fmtSignal } from "@/lib/signals";
import { wordCountChars, normalizeForWordCount } from "@/lib/wordcount";
import { detectSecondPressRelease } from "@/lib/detectSecondPressRelease";
import { runLlm } from "@/lib/openai";
import {
  validate5W,
  validateLengths,
  detectStrongClaims,
  detectContactInfo,
  detectCommonStyleMistakes,
  detectNameInconsistency,
  type Generated,
} from "@/lib/validators";

export const runtime = "nodejs";

const MAX_PROCESS_MS = 360 * 1000;

function jsonError(jobId: string, signals: Signal[], status = 400) {
  return NextResponse.json({ signals: signals.map(fmtSignal), techLogUrl: `/api/techlog?jobId=${jobId}` }, { status });
}

async function writeTechLog(jobId: string, code: string, detail: string) {
  const lines = [
    `timestamp=${new Date().toISOString()}`,
    `jobId=${jobId}`,
    `code=${code}`,
    `detail=${detail}`,
  ].join("\n");
  await fs.writeFile(tmpPath(`${jobId}.techlog.txt`), lines, "utf-8");
}

export async function POST(req: Request) {
  const started = Date.now();
  const body = await req.json().catch(() => null);

  const jobId = String(body?.jobId ?? "");
  const apiKey = String(body?.apiKey ?? "");

  if (!apiKey.trim()) {
    return NextResponse.json({ signals: ["API-key is vereist om verder te gaan."] }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ signals: ["W010: Technisch probleem: sessie is verlopen. Upload het document opnieuw."] }, { status: 400 });
  }

  try {
    const source = await fs.readFile(job.sourcePath, "utf-8");
    const cleanedSource = normalizeForWordCount(source);

    if (wordCountChars(cleanedSource) < 950) {
      await writeTechLog(jobId, "E004", "Source <950 chars (word count)");
      return jsonError(jobId, [{ code: "E004", level: "error", message: "Document te kort (minder dan 950 tekens)." }]);
    }

    const second = detectSecondPressRelease(cleanedSource);
    if (second.score >= 4 && second.secondSectionChars >= 900) {
      await writeTechLog(jobId, "E007", `Second PR detected score=${second.score} sectionChars=${second.secondSectionChars}`);
      return jsonError(jobId, [{ code: "E007", level: "error", message: "Meerdere persberichten in één document gevonden. Lever per document één persbericht aan dat door deze tool wordt verwerkt." }]);
    }

    const signals: Signal[] = [];
    if (second.score >= 2 && second.score <= 3) {
      signals.push({ code: "W015", level: "warning", message: "Mogelijk tweede persbericht in document gevonden. Controleer de output extra goed." });
    }

    const contact = detectContactInfo(cleanedSource);
    if (contact.signal) signals.push(contact.signal);

    const timeLeft = MAX_PROCESS_MS - (Date.now() - started) - 15_000;
    if (timeLeft <= 5_000) {
      await writeTechLog(jobId, "E005", "Not enough time left before timeout");
      return jsonError(jobId, [{ code: "E005", level: "error", message: "Maximale verwerkingstijd overschreden. Herstart de tool (Ctrl+F5) en probeer het opnieuw." }], 408);
    }

    const llmOut = await runLlm(apiKey, cleanedSource, Math.min(timeLeft, 330_000)).catch(async (e: any) => {
      const msg = String(e?.message ?? e);
      const code = msg.includes("aborted") ? "E005" : "W010";
      await writeTechLog(jobId, code, `LLM error: ${msg}`);
      return null;
    });

    if (!llmOut) {
      return jsonError(jobId, [{ code: "W010", level: "warning", message: "Technisch probleem tijdens verwerking. Probeer opnieuw." }], 500);
    }

    const gen: Generated = {
      kop: llmOut.kop,
      intro: llmOut.intro,
      body: llmOut.body,
      bron: llmOut.bron,
      fiveW: llmOut.fiveW,
      contactNietVoorPublicatie: llmOut.contactNietVoorPublicatie || contact.extracted,
      labels: llmOut.labels,
    };

    const v5 = validate5W(gen);
    if (v5.hardError) {
      await writeTechLog(jobId, "E006", "Two or more W's missing");
      return jsonError(jobId, [v5.hardError]);
    }
    signals.push(...v5.warnings);

    signals.push(...detectStrongClaims(`${gen.kop} ${gen.intro} ${gen.body}`));
    signals.push(...detectCommonStyleMistakes(`${gen.kop} ${gen.intro} ${gen.body}`));
    signals.push(...detectNameInconsistency(cleanedSource, `${gen.kop}\n${gen.intro}\n${gen.body}`));
    signals.push(...validateLengths(gen));

    const signalLines = signals.map(fmtSignal);
    const contactBlock = gen.contactNietVoorPublicatie?.trim()
      ? `\n\nCONTACT (niet voor publicatie)\n${gen.contactNietVoorPublicatie.trim()}`
      : "";

    const outTxt = [
      gen.kop.trim(),
      "",
      gen.intro.trim(),
      "",
      gen.body.trim(),
      "",
      `BRON: ${gen.bron.trim()}`,
      "",
      "SIGNALEN",
      ...signalLines.map((s) => `- ${s}`),
      contactBlock,
      "",
    ].join("\n");

    const outPath = tmpPath(`${jobId}.out.txt`);
    await fs.writeFile(outPath, outTxt, "utf-8");

    const genLen = wordCountChars(`${gen.intro} ${gen.body}`);
    if (genLen < 950) {
      await writeTechLog(jobId, "E004", "Generated intro+body <950 chars");
      await fs.unlink(outPath).catch(() => {});
      return jsonError(jobId, [{ code: "E004", level: "error", message: "Te weinig brontekst om nieuwsbericht te genereren." }]);
    }

    return NextResponse.json({ signals: signalLines });
  } catch (e: any) {
    await writeTechLog(jobId, "W010", `Unexpected error: ${String(e?.message ?? e)}`);
    return jsonError(jobId, [{ code: "W010", level: "warning", message: "Technisch probleem tijdens verwerking. Probeer opnieuw." }], 500);
  }
}
