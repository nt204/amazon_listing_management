import test from "node:test";
import assert from "node:assert/strict";

function validateGuideInput(input: {
  title: string;
  filename: string;
  size: number;
}) {
  if (!input.title || input.title.trim().length < 2) {
    throw new Error("Tiêu đề tài liệu hướng dẫn phải có ít nhất 2 ký tự.");
  }
  if (!input.filename.toLowerCase().endsWith(".pdf")) {
    throw new Error("Hệ thống chỉ hỗ trợ định dạng file PDF (.pdf).");
  }
  if (input.size > 25_000_000) {
    throw new Error("File PDF không được vượt quá 25MB.");
  }
  return true;
}

test("validateGuideInput accepts valid PDF guides", () => {
  assert.equal(
    validateGuideInput({
      title: "Hướng dẫn tạo Listing",
      filename: "guide.pdf",
      size: 1024 * 500,
    }),
    true,
  );
});

test("validateGuideInput rejects invalid inputs (short title, non-pdf, oversized)", () => {
  assert.throws(
    () => validateGuideInput({ title: " ", filename: "guide.pdf", size: 1000 }),
    /Tiêu đề/,
  );
  assert.throws(
    () => validateGuideInput({ title: "Hướng dẫn", filename: "guide.docx", size: 1000 }),
    /PDF/,
  );
  assert.throws(
    () => validateGuideInput({ title: "Hướng dẫn", filename: "guide.pdf", size: 30_000_000 }),
    /25MB/,
  );
});
