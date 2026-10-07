import { spawn } from "node:child_process";
import path from "node:path";
import { createScanJob } from "./indexer";
import { run, now } from "./db";
export function launchScan(rootId: string) {
  const job = createScanJob(rootId);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(process.cwd(), "scripts/scan.ts"),
      rootId,
      job,
    ],
    { cwd: process.cwd(), env: process.env, stdio: "ignore", detached: true },
  );
  if (child.pid)
    run("UPDATE scan_jobs SET worker_pid=? WHERE id=?", child.pid, job);
  child.on("exit", (code) => {
    if (code !== 0) {
      run(
        "UPDATE scan_jobs SET status='failed',errors=?,finished_at=? WHERE id=? AND status IN ('queued','running')",
        JSON.stringify(["Scanner exited unexpectedly. Re-index to retry."]),
        now(),
        job,
      );
      run(
        "UPDATE library_roots SET status='ready' WHERE id=? AND status='scanning'",
        rootId,
      );
    }
  });
  child.on("error", () => {
    run(
      "UPDATE scan_jobs SET status='failed',errors=?,finished_at=? WHERE id=?",
      JSON.stringify([
        "Scanner could not start. Run pnpm scan from the server terminal.",
      ]),
      now(),
      job,
    );
  });
  child.unref();
  return job;
}
