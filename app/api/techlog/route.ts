import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { tmpPath } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = String(searchParams.get("jobId") ?? "");

  const p = tmpPath(`${jobId}.techlog.txt`);
  const data = await fs.readFile(p).catch(() => null);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"techlog.txt\"",
      "Cache-Control": "no-store",
    },
  });
}
