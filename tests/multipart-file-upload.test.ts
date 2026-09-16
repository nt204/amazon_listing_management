import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { streamMultipartFileUpload } from "../lib/multipart-file-upload";

test("multipart uploads stream to a temporary file and clean it up", async () => {
  const form = new FormData();
  form.set("storeName", "TEST");
  form.set("file", new File(["a,b\n1,2\n"], "report.csv", { type: "text/csv" }));
  const upload = await streamMultipartFileUpload(
    new Request("http://localhost/upload", { method: "POST", body: form }),
    { fieldName: "file", maxFileBytes: 1_024 },
  );

  assert.equal(upload.fields.storeName, "TEST");
  assert.equal(upload.file.name, "report.csv");
  assert.equal(upload.file.bytes, 8);
  assert.equal((await readFile(upload.file.path, "utf8")), "a,b\n1,2\n");
  await upload.cleanup();
  await assert.rejects(access(upload.file.path));
});

test("multipart uploads reject files beyond the byte limit", async () => {
  const form = new FormData();
  form.set("file", new File(["123456"], "large.csv", { type: "text/csv" }));
  await assert.rejects(
    streamMultipartFileUpload(
      new Request("http://localhost/upload", { method: "POST", body: form }),
      { fieldName: "file", maxFileBytes: 5 },
    ),
    /exceeds 5 bytes/,
  );
});
