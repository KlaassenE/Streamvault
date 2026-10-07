"use client";
import { useState, useEffect, useRef } from "react";
import { FolderPlus, RefreshCw, Archive } from "lucide-react";
import { FolderPicker } from "./folder-picker";
import { Button } from "./ui/button";
type Root = {
  id: string;
  path: string;
  label: string;
  status: string;
  archived: number;
  last_scanned_at: number | null;
};
type Job = {
  id: string;
  root_id: string;
  status: string;
  discovered: number;
  imported: number;
  errors: string;
  started_at: number;
};
export function LibraryManager({
  initialRoots,
  initialJobs,
}: {
  initialRoots: Root[];
  initialJobs: Job[];
}) {
  const [roots, setRoots] = useState(initialRoots);
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const latest = useRef(jobs);
  latest.current = jobs;
  async function refresh(signal?: AbortSignal) {
    try {
      const response = await fetch("/api/library", { signal });
      if (response.ok) {
        const data = await response.json();
        setRoots(data.roots);
        setJobs(data.jobs);
      }
    } catch {}
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (
        !document.hidden &&
        latest.current.some(
          (j) => j.status === "running" || j.status === "queued",
        )
      )
        await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(tick, 2000);
    };
    if (jobs.some((j) => ["running", "queued"].includes(j.status)))
      timer = setTimeout(tick, 1500);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [jobs.some((j) => ["running", "queued"].includes(j.status))]);
  async function action(route: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setFolder("");
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not complete this action.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addFolder() {
    if (folder.trim()) {
      await action("library", { path: folder.trim() });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/library/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!data.supported) setPickerOpen(true);
      else if (data.path) {
        setFolder(data.path);
        await action("library", { path: data.path });
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not choose a folder.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack-gap">
      <FolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          setPickerOpen(false);
          setFolder(path);
          void action("library", { path });
        }}
      />
      <section className="settings-panel">
        <h2>Add a library folder</h2>
        <p className="muted small">
          Use the absolute path on the hosting device. Existing yt-dlp files
          stay in place.
        </p>
        <form
          className="form-stack"
          style={{ marginTop: 20 }}
          onSubmit={(event) => {
            event.preventDefault();
            void addFolder();
          }}
        >
          <label className="field">
            Folder path
            <input
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="/mnt/videos/channel"
            />
          </label>
          <div>
            <Button disabled={busy}>
              <FolderPlus size={17} />
              Add and index
            </Button>
          </div>
        </form>
      </section>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <section className="settings-panel">
        <h2>Library folders</h2>
        {!roots.length && <p className="muted small">No folders added yet.</p>}
        {roots.map((root) => (
          <div className="list-row" key={root.id}>
            <div>
              <strong>{root.label}</strong>
              <p className="wrap-path">{root.path}</p>
              <p className="small muted">
                {root.archived ? "Archived" : root.status}
                {root.last_scanned_at
                  ? ` · Last scan ${new Date(root.last_scanned_at).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
            <div className="inline-actions">
              {!root.archived && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || root.status === "scanning"}
                    onClick={() =>
                      void action("library/scan", { rootId: root.id })
                    }
                  >
                    <RefreshCw size={14} />
                    Re-index
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Archive ${root.label}`}
                    disabled={busy || root.status === "scanning"}
                    onClick={() => {
                      if (
                        confirm(
                          "Hide this folder from your library? The original files and all user state will be kept.",
                        )
                      )
                        void action("library/archive", { rootId: root.id });
                    }}
                  >
                    <Archive size={16} />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>
      <section className="settings-panel">
        <h2>Recent scans</h2>
        {jobs.map((job) => (
          <div className="list-row" key={job.id}>
            <div>
              <strong>
                {roots.find((r) => r.id === job.root_id)?.label ||
                  "Library scan"}
              </strong>
              <p className="muted small">
                {job.status} · {job.discovered} discovered · {job.imported}{" "}
                indexed
              </p>
              {(JSON.parse(job.errors) as string[]).map((message, index) => (
                <p className="wrap-path" key={index}>
                  {message}
                </p>
              ))}
            </div>
          </div>
        ))}
        {!jobs.length && (
          <p className="muted small">Scan activity will appear here.</p>
        )}
      </section>
    </div>
  );
}
