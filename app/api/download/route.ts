import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getJob, tmpPath, cleanupJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = String(searchParams.get("jobId") ?? "");

  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const outPath = tmpPath(`${jobId}.out.txt`);
  const data = await fs.readFile(outPath).catch(() => null);
  if (!data) return NextResponse.json({ error: "no_output" }, { status: 404 });

  const res = new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"nieuwsbericht.txt\"",
      "Cache-Control": "no-store",
    },
  });

  cleanupJob(jobId);
  return res;
}
