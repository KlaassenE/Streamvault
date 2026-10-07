import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { recoverScanJobs } from "@/lib/indexer";
import { collection } from "@/lib/library";
import { Shell } from "@/components/shell";
import { LibraryManager } from "@/components/library-manager";
import { VideoGrid } from "@/components/video-grid";
export default async function Library() {
  const user = await requireUser();
  if (user.is_admin) recoverScanJobs();
  const items = collection(user.id, "library");
  return (
    <Shell user={user} active="library">
      <div className="page-heading">
        <div>
          <h1>Your library</h1>
          <p>
            {user.is_admin
              ? "Existing files. Rich metadata. Everything kept in place."
              : "All the videos in this library."}
          </p>
        </div>
      </div>
      {user.is_admin ? (
        <LibraryManager
          initialRoots={all(
            "SELECT * FROM library_roots ORDER BY created_at DESC",
          )}
          initialJobs={all(
            "SELECT * FROM scan_jobs ORDER BY started_at DESC LIMIT 20",
          )}
        />
      ) : (
        <VideoGrid
          initial={items}
          initialNext={items.length === 24 ? 24 : null}
          endpoint="/api/collection?kind=library"
        />
      )}
    </Shell>
  );
}
