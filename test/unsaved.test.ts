import { describe, expect, test } from "bun:test";
import { batchHasUnsavedWork, manualHasUnsavedWork } from "@/shared/unsaved";

describe("manualHasUnsavedWork", () => {
  test("step 1 kosong bukan isian berjalan", () => {
    expect(manualHasUnsavedWork(1, "")).toBe(false);
    expect(manualHasUnsavedWork(1, "   ")).toBe(false);
  });

  test("identitas sudah diketik di step 1 -> ada isian", () => {
    expect(manualHasUnsavedWork(1, "3322184301690004")).toBe(true);
  });

  test("sudah pindah ke step 2 atau 3 -> ada isian walau tanpa identitas", () => {
    expect(manualHasUnsavedWork(2, "")).toBe(true);
    expect(manualHasUnsavedWork(3, "")).toBe(true);
  });

  test("step 4 (nomor terbit) tidak dihitung - nomornya sudah sah", () => {
    expect(manualHasUnsavedWork(4, "3322184301690004")).toBe(false);
  });
});

describe("batchHasUnsavedWork", () => {
  test("kolom identitas kosong dan tidak ada file -> bukan isian berjalan", () => {
    expect(batchHasUnsavedWork("", false)).toBe(false);
    expect(batchHasUnsavedWork("  ", false)).toBe(false);
  });

  test("identitas sudah diketik -> ada isian", () => {
    expect(batchHasUnsavedWork("3322184301690004", false)).toBe(true);
  });

  test("file Excel sudah dibaca tapi belum ditambahkan -> ada isian", () => {
    expect(batchHasUnsavedWork("", true)).toBe(true);
  });
});
