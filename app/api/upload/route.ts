import { NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

import { putJob, tmpPath } from "@/lib/jobs";
import { normalizeForWordCount, wordCountChars } from "@/lib/wordcount";
import type { Signal } from "@/lib/signals";
import { fmtSignal } from "@/lib/signals";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

function errorResponse(jobId: string, signals: Signal[], status = 400) {
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

async function extractText(file: File, ext: string): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (ext === "txt") return buf.toString("utf-8");
  if (ext === "docx") {
    const res = await mammoth.extractRawText({ buffer: buf });
    return res.value ?? "";
  }
  if (ext === "pdf") {
    const res = await pdfParse(buf);
    return res.text ?? "";
  }
  throw new Error("unsupported_extension");
}

export async function POST(req: Request) {
  const jobId = crypto.randomBytes(16).toString("hex");

  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      await writeTechLog(jobId, "E002", "No file in form-data");
      return errorResponse(jobId, [{ code: "E002", level: "error", message: "Onleesbaar bestand." }]);
    }

    if (file.size > MAX_BYTES) {
      await writeTechLog(jobId, "E001", `File too large: ${file.size} bytes`);
      return errorResponse(jobId, [{ code: "E001", level: "error", message: "Bestand te groot (meer dan 10 MB)." }]);
    }

    const ext = (path.extname(file.name).toLowerCase() || "").replace(".", "");
    if (!["txt", "docx", "pdf"].includes(ext)) {
      await writeTechLog(jobId, "E002", `Unsupported extension: ${ext}`);
      return errorResponse(jobId, [{ code: "E002", level: "error", message: "Onleesbaar bestand." }]);
    }

    const raw = await extractText(file, ext).catch(async (e: any) => {
      await writeTechLog(jobId, "E002", `Extract failed: ${String(e?.message ?? e)}`);
      return null;
    });

    if (raw === null) {
      return errorResponse(jobId, [{ code: "E002", level: "error", message: "Onleesbaar bestand." }]);
    }

    const cleaned = normalizeForWordCount(raw);

    // Upload rule: <800 tekens extracteerbaar -> afkeur (ook scan-PDF).
    if (cleaned.length < 800) {
      await writeTechLog(jobId, "E003", `Extracted chars <800 (${cleaned.length})`);
      return errorResponse(jobId, [{ code: "E003", level: "error", message: "Te weinig bruikbare brontekst. Upload een ander bestand." }]);
    }

    await fs.writeFile(tmpPath(`${jobId}.source.txt`), cleaned, "utf-8");
    putJob({ jobId, createdAt: Date.now(), sourcePath: tmpPath(`${jobId}.source.txt`), status: "uploaded" });

    const signals: Signal[] = [];
    if (wordCountChars(cleaned) < 950) {
      signals.push({ code: "E004", level: "error", message: "Document te kort (minder dan 950 tekens)." });
    }

    return NextResponse.json({ jobId, signals: signals.map(fmtSignal) });
  } catch (e: any) {
    await writeTechLog(jobId, "W010", `Unexpected error: ${String(e?.message ?? e)}`);
    return errorResponse(jobId, [{ code: "W010", level: "warning", message: "Technisch probleem tijdens verwerking. Probeer opnieuw." }], 500);
  }
}
