"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type ExportJob = {
  id: string;
  from: string;
  to: string;
  status: "pending" | "processing" | "ready" | "failed";
  filename: string;
  error: string | null;
};
export default function ExportReports({ refreshKey }: { refreshKey: number }) {
  const version = useRef(0);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const load = useCallback(async () => {
    const current = version.current;
    try {
      const response = await fetch("/api/exports", {
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 401) return;
      if (!response.ok) throw new Error("Could not load export status.");
      const body = await response.json();
      if (current !== version.current) return;
      setJobs(body.jobs);
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load, refreshKey]);
  async function download(job: ExportJob) {
    setDownloading(job.id);
    setError("");
    try {
      const response = await fetch(`/api/exports/${job.id}`, {
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = job.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      const removed = await fetch(`/api/exports/${job.id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(20000),
      });
      if (!removed.ok) throw new Error((await removed.json()).error);
      version.current++;
      setJobs((previous) => previous.filter((item) => item.id !== job.id));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setDownloading(null);
    }
  }
  if (!jobs.length && !error) return null;
  return (
    <section
      aria-label="Report exports"
      className="rounded-xl border bg-white p-4 mx-6 my-3 grid gap-3"
    >
      <h2 className="font-semibold">Report exports</h2>
      <p className="text-sm text-muted-foreground">
        Reports prepare in the background. Temporary CSVs are deleted after
        download.
      </p>
      {error && <p role="alert">{error}</p>}
      {jobs.map((job) => (
        <div
          key={job.id}
          className="flex flex-wrap items-center justify-between gap-3"
          role="group"
          aria-label={`Export ${job.from} to ${job.to}`}
        >
          <span>
            {job.from} – {job.to}
          </span>
          {job.status === "ready" ? (
            <Button
              disabled={downloading === job.id}
              onClick={() => void download(job)}
            >
              {downloading === job.id ? "Downloading…" : "Download CSV"}
            </Button>
          ) : job.status === "failed" ? (
            <span role="alert">{job.error}</span>
          ) : (
            <span role="status">
              {job.status === "pending" ? "Queued" : "Generating report…"}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}
