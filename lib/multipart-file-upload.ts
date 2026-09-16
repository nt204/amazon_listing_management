import Busboy from "@fastify/busboy";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class MultipartUploadError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export interface MultipartFileUpload {
  fields: Record<string, string>;
  file: { path: string; name: string; mimeType: string; bytes: number };
  cleanup: () => Promise<void>;
}

export async function streamMultipartFileUpload(
  request: Request,
  options: { fieldName: string; maxFileBytes: number; maxFields?: number },
): Promise<MultipartFileUpload> {
  if (!request.body) throw new MultipartUploadError("Request body is required.", 400);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new MultipartUploadError("Request must use multipart/form-data.", 415);
  }

  const directory = await mkdtemp(path.join(tmpdir(), "listing-upload-"));
  const destination = path.join(directory, "upload.bin");
  const fields: Record<string, string> = {};
  const files: MultipartFileUpload["file"][] = [];
  let fileWrite: Promise<void> | null = null;
  let limitExceeded = false;

  try {
    const parser = new Busboy({
      headers: {
        ...Object.fromEntries(request.headers),
        "content-type": contentType,
      },
      limits: {
        files: 1,
        fields: options.maxFields ?? 8,
        fileSize: options.maxFileBytes,
      },
    });

    parser.on("field", (name, value) => {
      fields[name] = value;
    });
    parser.on("file", (fieldName, stream, fileName, _encoding, mimeType) => {
      if (fieldName !== options.fieldName) {
        stream.resume();
        return;
      }
      let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
      });
      stream.on("limit", () => {
        limitExceeded = true;
      });
      const info = { path: destination, name: fileName, mimeType, bytes: 0 };
      files.push(info);
      fileWrite = pipeline(stream, createWriteStream(destination)).then(() => {
        info.bytes = bytes;
      });
    });

    const parserDone = new Promise<void>((resolve, reject) => {
      parser.once("finish", resolve);
      parser.once("error", reject);
    });
    await pipeline(Readable.fromWeb(request.body as never), parser);
    await parserDone;
    if (fileWrite) await fileWrite;

    if (limitExceeded) throw new MultipartUploadError(`File exceeds ${options.maxFileBytes} bytes.`, 413);
    const fileInfo = files[0];
    if (!fileInfo || fileInfo.bytes === 0) throw new MultipartUploadError("Vui lòng chọn file để tải lên.", 400);
    return {
      fields,
      file: fileInfo,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
