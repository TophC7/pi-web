import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { ATTACHMENT_GRACE_MS, pruneAttachmentDirs, storeAttachment } = await jiti.import("./attachments.ts");

function temporaryDirectory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-attachments-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function attachmentDirectory(root, name, mtime) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "x.png"), name);
  fs.utimesSync(dir, new Date(mtime), new Date(mtime));
  return dir;
}

test("storing identical bytes and names preserves the original in a single file", (t) => {
  const root = path.join(temporaryDirectory(t), "attachments");
  const bytes = Buffer.from([0x00, 0xff, 0x80, 0x0d, 0x0a, 0x41]);

  const first = storeAttachment(root, "original.bin", bytes);
  const second = storeAttachment(root, "original.bin", bytes);

  assert.deepEqual(second, first);
  assert.deepEqual(fs.readFileSync(first.path), bytes);
  assert.deepEqual(fs.readdirSync(root), [first.sha256]);
  assert.deepEqual(fs.readdirSync(path.dirname(first.path)), ["original.bin"]);
});

test("different bytes with the same name have distinct stored paths", (t) => {
  const root = path.join(temporaryDirectory(t), "attachments");
  const firstBytes = Buffer.from("first original");
  const secondBytes = Buffer.from("second original");

  const first = storeAttachment(root, "same-name.txt", firstBytes);
  const second = storeAttachment(root, "same-name.txt", secondBytes);

  assert.notEqual(second.path, first.path);
  assert.deepEqual(fs.readFileSync(first.path), firstBytes);
  assert.deepEqual(fs.readFileSync(second.path), secondBytes);
});

test("pruning removes only old unreferenced hash directories", (t) => {
  const dir = temporaryDirectory(t);
  const root = path.join(dir, "attachments");
  const now = Date.UTC(2025, 0, 2);
  const old = now - ATTACHMENT_GRACE_MS - 1000;
  const recent = now - ATTACHMENT_GRACE_MS + 1000;
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const C = "c".repeat(64);
  const referenced = attachmentDirectory(root, A, old);
  const orphan = attachmentDirectory(root, B, old);
  const draft = attachmentDirectory(root, C, recent);
  const nonhash = attachmentDirectory(root, "not-a-content-hash", old);
  const session = path.join(dir, "session.jsonl");
  fs.writeFileSync(session, JSON.stringify({ text: `@${path.join(referenced, "x.png")}` }) + "\n");

  assert.deepEqual(pruneAttachmentDirs(root, [session], now), [B]);
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.readFileSync(path.join(referenced, "x.png"), "utf8"), A);
  assert.equal(fs.readFileSync(path.join(draft, "x.png"), "utf8"), C);
  assert.equal(fs.readFileSync(path.join(nonhash, "x.png"), "utf8"), "not-a-content-hash");
});

test("a non-ENOENT session scan failure throws before any attachment is deleted", (t) => {
  const dir = temporaryDirectory(t);
  const root = path.join(dir, "attachments");
  const now = Date.UTC(2025, 0, 2);
  const old = now - ATTACHMENT_GRACE_MS - 1000;
  const hashes = ["a".repeat(64), "b".repeat(64)];
  for (const hash of hashes) attachmentDirectory(root, hash, old);
  const session = path.join(dir, "session.jsonl");
  fs.writeFileSync(session, "");
  const unreadableSession = path.join(dir, "session-directory");
  fs.mkdirSync(unreadableSession);

  assert.throws(() => pruneAttachmentDirs(root, [session, unreadableSession], now), { code: "EISDIR" });
  assert.deepEqual(fs.readdirSync(root).sort(), hashes);
  for (const hash of hashes) {
    assert.equal(fs.readFileSync(path.join(root, hash, "x.png"), "utf8"), hash);
  }
});
