import fs from "node:fs/promises";
import path from "node:path";

export type JobStatus = "uploaded" | "processed" | "error";

export type Job = {
  jobId: string;
  createdAt: number;
  sourcePath: string;
  status: JobStatus;
};

const jobs = new Map<string, Job>();

export function putJob(job: Job) {
  jobs.set(job.jobId, job);
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function tmpPath(name: string) {
  return path.join("/tmp", name);
}

export async function cleanupJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  const files = [job.sourcePath, tmpPath(`${jobId}.out.txt`), tmpPath(`${jobId}.techlog.txt`)];
  for (const f of files) {
    try { await fs.unlink(f); } catch {}
  }
  jobs.delete(jobId);
}

const TTL_MS = 20 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > TTL_MS) cleanupJob(id);
  }
}, 60 * 1000);
