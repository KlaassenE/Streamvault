"use client";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Folder, ArrowUp, X } from "lucide-react";
import { Button } from "./ui/button";
type Listing = {
  path: string;
  parent: string | null;
  locations: string[];
  folders: { name: string; path: string }[];
};
export function FolderPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  async function load(path?: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/library/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`,
        { signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setListing(data);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "This folder could not be opened.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    if (open) {
      setListing(null);
      void load();
    }
    return () => request.current?.abort();
  }, [open]);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="folder-dialog">
          <div className="folder-dialog-header">
            <Dialog.Title>Choose a library folder</Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close folder picker"
              >
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="muted small">
            Browse folders on the device hosting Streamvault.
          </Dialog.Description>
          {listing && (
            <>
              <div className="folder-dialog-locations">
                {listing.locations.map((location) => (
                  <Button
                    key={location}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void load(location)}
                  >
                    {location}
                  </Button>
                ))}
              </div>
              <div className="folder-dialog-header">
                <p className="wrap-path">{listing.path}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Parent folder"
                  disabled={busy || !listing.parent}
                  onClick={() => void load(listing.parent!)}
                >
                  <ArrowUp size={18} />
                </Button>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="folder-dialog-list" aria-busy={busy}>
            {busy ? (
              <p className="muted small">Loading folders…</p>
            ) : (
              listing?.folders.map((folder) => (
                <button
                  key={folder.path}
                  onClick={() => void load(folder.path)}
                >
                  <Folder size={18} />
                  {folder.name}
                </button>
              ))
            )}
            {!busy && listing && !listing.folders.length && (
              <p className="muted small">No subfolders here.</p>
            )}
          </div>
          <div className="folder-dialog-actions">
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button
              disabled={busy || !listing || !!error}
              onClick={() => {
                if (listing) onSelect(listing.path);
              }}
            >
              Select and index
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
