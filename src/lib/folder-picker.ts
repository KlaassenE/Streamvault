import { promises as fs } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inside } from "./indexer";
const execute = promisify(execFile);
export function nativePickerCommand(
  platform: NodeJS.Platform,
  env: Partial<NodeJS.ProcessEnv>,
) {
  if (env.STREAMVAULT_NATIVE_FOLDER_PICKER === "false") return null;
  if (platform === "darwin")
    return {
      file: "/usr/bin/osascript",
      args: [
        "-e",
        'try\nreturn POSIX path of (choose folder with prompt "Choose your Streamvault video folder")\non error number -128\nreturn ""\nend try',
      ],
    };
  if (platform === "win32")
    return {
      file: "powershell.exe",
      args: [
        "-NoProfile",
        "-STA",
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = "Choose your Streamvault video folder"; $picker.ShowNewFolderButton = $false; if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write($picker.SelectedPath) }; $picker.Dispose()',
      ],
    };
  if (platform === "linux" && (env.DISPLAY || env.WAYLAND_DISPLAY))
    return {
      file: "zenity",
      args: [
        "--file-selection",
        "--directory",
        "--title=Choose your Streamvault video folder",
      ],
    };
  return null;
}
let picking = false;
export async function pickNativeFolder() {
  const command = nativePickerCommand(process.platform, process.env);
  if (!command) return { supported: false };
  if (picking) throw new Error("A folder picker is already open.");
  picking = true;
  try {
    const result = await execute(command.file, command.args, {
      timeout: 120000,
      maxBuffer: 16384,
      windowsHide: false,
    });
    const selected = result.stdout.trim();
    return { supported: true, path: selected || null };
  } catch (error) {
    if (process.platform === "linux" && (error as { code?: number }).code === 1)
      return { supported: true, path: null };
    return { supported: false };
  } finally {
    picking = false;
  }
}
export function isLocalFolderPicker(request: Request) {
  try {
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(request.headers.get("origin") || request.url).hostname,
      ) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(`http://${request.headers.get("host")}`).hostname,
      )
    );
  } catch {
    return false;
  }
}
export async function browseFolders(requested?: string) {
  const allowed = await Promise.all(
    (process.env.STREAMVAULT_ALLOWED_ROOTS || "")
      .split(";")
      .filter(Boolean)
      .map((root) => fs.realpath(path.resolve(root))),
  );
  let locations = allowed.length
    ? allowed
    : [homedir(), path.parse(homedir()).root];
  if (!allowed.length && process.platform === "win32") {
    const drives = await Promise.all(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(async (letter) => {
        const drive = `${letter}:\\`;
        try {
          await fs.access(drive);
          return drive;
        } catch {
          return null;
        }
      }),
    );
    locations = [
      homedir(),
      ...drives.filter((drive): drive is string => drive !== null),
    ];
  }
  const current = await fs.realpath(requested || locations[0]);
  if (allowed.length && !allowed.some((root) => inside(root, current)))
    throw new Error("This folder is outside the configured allowed roots.");
  const entries = await fs.readdir(current, { withFileTypes: true });
  const parent = path.dirname(current);
  return {
    path: current,
    parent:
      parent !== current &&
      (!allowed.length || allowed.some((root) => inside(root, parent)))
        ? parent
        : null,
    locations: [...new Set(locations)],
    folders: entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => ({
        name: entry.name,
        path: path.join(current, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
