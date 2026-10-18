import { getAgentDir } from "@earendil-works/pi-coding-agent";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { listAllSessions } from "./session-reader";

export const ATTACHMENT_GRACE_MS = 24 * 60 * 60 * 1000;

export function attachmentsRoot(): string {
  return path.join(getAgentDir(), "attachments");
}

export function storeAttachment(root: string, fileName: string, bytes: Buffer): { path: string; sha256: string } {
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const dir = path.join(root, sha256);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = path.join(dir, fileName);

  let existing: fs.Stats | undefined;
  try {
    existing = fs.lstatSync(dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error("Cannot store over a directory or symbolic link");
  }
  if (!existing) {
    const staging = path.join(dir, ".pi-upload-" + crypto.randomUUID());
    try {
      fs.writeFileSync(staging, bytes, { flag: "wx", mode: 0o600 });
      fs.renameSync(staging, dest);
    } finally {
      try {
        fs.unlinkSync(staging);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  const now = new Date();
  fs.utimesSync(dir, now, now);
  return { path: dest, sha256 };
}

export function pruneAttachmentDirs(root: string, sessionFiles: string[], now: number, graceMs = ATTACHMENT_GRACE_MS): string[] {
  const referenced = new Set<string>();
  // Finish the entire reference scan before deleting anything.
  for (const sessionFile of sessionFiles) {
    let contents: string;
    try {
      contents = fs.readFileSync(sessionFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const match of contents.matchAll(/attachments\/([0-9a-f]{64})\//g)) {
      referenced.add(match[1]);
    }
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (!/^[0-9a-f]{64}$/.test(entry.name) || !entry.isDirectory() || referenced.has(entry.name)) continue;
    const dir = path.join(root, entry.name);
    if (fs.statSync(dir).mtimeMs > now - graceMs) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

export async function pruneUnreferencedAttachments(): Promise<string[]> {
  const files = new Set((await listAllSessions({ force: true })).map((session) => session.path));
  const sessionsDir = path.join(getAgentDir(), "sessions");
  let entries: string[];
  try {
    entries = fs.readdirSync(sessionsDir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    entries = [];
  }
  for (const entry of entries) {
    if (entry.endsWith(".jsonl")) files.add(path.join(sessionsDir, entry));
  }
  return pruneAttachmentDirs(attachmentsRoot(), [...files], Date.now());
}
