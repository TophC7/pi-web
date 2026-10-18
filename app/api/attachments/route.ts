import { NextRequest, NextResponse } from "next/server";
import { attachmentsRoot, storeAttachment } from "@/lib/attachments";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { validateUploadFileName } from "@/lib/file-upload";
import { isApiRequestAllowed } from "@/lib/request-security";

const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
// Multipart boundaries and headers are not file bytes, but must be bounded too.
const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024;

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    let formData: FormData;
    try {
      formData = await parseFormDataWithinLimit(request, MAX_UPLOAD_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "Uploads must total 100MB or less" }, { status: 413 });
      }
      throw error;
    }
    const files = formData.getAll("files").filter((entry): entry is File => typeof entry !== "string");
    if (files.some((file) => file.size > MAX_UPLOAD_FILE_BYTES)) {
      return NextResponse.json({ error: "Each upload must be 25MB or smaller" }, { status: 413 });
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES) {
      return NextResponse.json({ error: "Uploads must total 100MB or less" }, { status: 413 });
    }
    if (files.length === 0) {
      return NextResponse.json({ error: "No files selected" }, { status: 400 });
    }

    const attachments: Array<{
      index: number;
      name: string;
      path: string;
      sha256: string;
      size: number;
      mimeType: string;
    }> = [];
    const errors: Array<{ index: number; name: string; error: string }> = [];

    for (const [index, file] of files.entries()) {
      const validationError = validateUploadFileName(file.name);
      if (validationError) {
        errors.push({ index, name: file.name, error: validationError });
        continue;
      }

      try {
        const stored = storeAttachment(attachmentsRoot(), file.name, Buffer.from(await file.arrayBuffer()));
        attachments.push({
          index,
          name: file.name,
          path: stored.path,
          sha256: stored.sha256,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        });
      } catch (error) {
        errors.push({ index, name: file.name, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return NextResponse.json(
      { attachments, errors },
      { status: errors.length > 0 ? 207 : 200 },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
