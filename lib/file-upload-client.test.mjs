import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { attachmentMentionText, isInlineImage, splitDroppedItems } = await jiti.import("./file-upload-client.ts");

const file = (name, type = "") => new File(["x"], name, { type });

test("a chat drop keeps images and other files in drop order and leaves folders out", () => {
  const photo = file("photo.png", "image/png");
  const notes = file("notes.md", "text/markdown");
  const vector = file("drawing.svg", "image/svg+xml");
  const data = file("data.bin");
  const result = splitDroppedItems([
    { kind: "file", file: photo },
    { kind: "file", file: notes },
    { kind: "folder", name: "src" },
    { kind: "file", file: vector },
    { kind: "file", file: data },
  ]);
  assert.deepEqual(result.files, [photo, notes, vector, data]);
  assert.deepEqual(result.folders, ["src"]);
});

test("stored attachment mentions preserve absolute paths and quote spaces", () => {
  assert.equal(
    attachmentMentionText([{ path: "/s/a/x.png" }, { path: "/s/b/my notes.md" }]),
    '@/s/a/x.png @"/s/b/my notes.md" ',
  );
  assert.equal(attachmentMentionText([]), "");
});

test("only SDK-supported raster MIME types are selected for inline images", () => {
  for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
    assert.equal(isInlineImage({ type }), true, type);
  }
  for (const type of ["image/svg+xml", "image/avif", "image/bmp", "application/pdf", ""]) {
    assert.equal(isInlineImage({ type }), false, type);
  }
});
