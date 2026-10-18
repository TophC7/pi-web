import { buildAtMentionText } from "./file-fuzzy";
import { encodeFilePathForApi } from "./file-paths";

/** Browser side of `POST /api/files/[...path]?type=upload`; mirrors `lib/file-upload.ts`. */
export type UploadConflictStrategy = "error" | "overwrite" | "skip";

export interface UploadError {
  name: string;
  error: string;
}

export interface UploadResponse {
  uploaded?: string[];
  skipped?: string[];
  errors?: UploadError[];
  conflicts?: string[];
  nonReplaceable?: string[];
  error?: string;
}

/** Stored chat attachments returned by `POST /api/attachments`. */
export interface AttachmentUploadResponse {
  attachments: Array<{
    index: number;
    name: string;
    path: string;
    sha256: string;
    size: number;
    mimeType: string;
  }>;
  errors: Array<{ index: number; name: string; error: string }>;
  error?: string;
}

/**
 * Uploads files into one directory through the file API.
 * @param targetDirectory The directory the files are written to
 * @param files The files, written under their own names
 * @param strategy What the server does with a name that already exists
 * @param onProgress Upload progress in percent, when the browser reports it
 * @returns The HTTP status and the parsed response body
 */
export function uploadFiles(
  targetDirectory: string,
  files: File[],
  strategy: UploadConflictStrategy,
  onProgress?: (progress: number) => void,
): Promise<{ status: number; data: UploadResponse }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file, file.name));

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/files/${encodeFilePathForApi(targetDirectory)}?type=upload&conflict=${strategy}`,
    );
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading files"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.onload = () => {
      let data: UploadResponse = {};
      try {
        data = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        if (xhr.responseText) data.error = xhr.responseText;
      }
      resolve({ status: xhr.status, data });
    };
    xhr.send(formData);
  });
}

/** Uploads original chat files to Pi-owned storage, outside the workspace. */
export async function uploadAttachments(
  files: File[],
  onProgress?: (progress: number) => void,
): Promise<{ status: number; data: AttachmentUploadResponse }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ status: number; data: AttachmentUploadResponse }>();
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file, file.name));

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/attachments");
  xhr.upload.onprogress = (event) => {
    if (onProgress && event.lengthComputable && event.total > 0) {
      onProgress(Math.round((event.loaded / event.total) * 100));
    }
  };
  xhr.onerror = () => reject(new Error("Network error while uploading files"));
  xhr.onabort = () => reject(new Error("Upload cancelled"));
  xhr.onload = () => {
    let data: AttachmentUploadResponse = { attachments: [], errors: [] };
    try {
      data = JSON.parse(xhr.responseText) as AttachmentUploadResponse;
    } catch {
      if (xhr.responseText) data.error = xhr.responseText;
    }
    resolve({ status: xhr.status, data });
  };
  xhr.send(formData);
  return promise;
}

/** Absolute @mentions for stored attachments, in the supplied order. */
export function attachmentMentionText(attachments: Array<{ path: string }>): string {
  return attachments.map((attachment) => buildAtMentionText(attachment.path, false)).join("");
}

/** Whether the SDK can also receive this stored original as an inline image. */
export function isInlineImage(file: Pick<File, "type">): boolean {
  return file.type === "image/png" || file.type === "image/jpeg" ||
    file.type === "image/gif" || file.type === "image/webp";
}

/** One file or folder dropped onto the chat. */
export type DroppedItem = { kind: "file"; file: File } | { kind: "folder"; name: string };

/**
 * Collects every dropped file for store-backed attachments, including images.
 * Folders are left out because the attachment endpoint takes files only.
 * @param items The dropped items, in drop order
 * @returns Files in drop order and the names of skipped folders
 */
export function splitDroppedItems(items: DroppedItem[]): { files: File[]; folders: string[] } {
  const files: File[] = [];
  const folders: string[] = [];
  for (const item of items) {
    if (item.kind === "folder") folders.push(item.name);
    else files.push(item.file);
  }
  return { files, folders };
}

