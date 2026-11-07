import { describe, expect, test } from "bun:test";
import { detectIdentifierType, normalizeIdentifier } from "@/shared/identifier";

function expectValid(type: "nik" | "bpjs" | "no_rm", raw: string): string {
  const result = normalizeIdentifier(type, raw);
  if (!result.ok) throw new Error(`ditolak: ${result.code}`);
  return result.value;
}

describe("normalizeIdentifier", () => {
  test("membuang spasi dan tanda hubung", () => {
    expect(expectValid("nik", " 3322 1843 0169 0004 ")).toBe("3322184301690004");
    expect(expectValid("nik", "3322-1843-0169-0004")).toBe("3322184301690004");
  });

  test("menerima angka yang diekspor Excel dengan .0 di ekor", () => {
    expect(expectValid("bpjs", "0002612743929.0")).toBe("0002612743929");
  });

  test("menolak notasi ilmiah - inti masalah Excel", () => {
    const result = normalizeIdentifier("nik", "3.32218430169E+15");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("scientific");
  });

  test("menolak NIK yang kehilangan nol di depan (jadi 15 digit)", () => {
    const result = normalizeIdentifier("nik", "332184301690004");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("nik_length");
      expect(result.message).toContain("16");
    }
  });

  test("menolak No. BPJS yang panjangnya bukan 13", () => {
    const result = normalizeIdentifier("bpjs", "000261274392");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("bpjs_length");
  });

  test("menolak NIK berisi huruf", () => {
    const result = normalizeIdentifier("nik", "332218430169000X");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("non_digit");
  });

  test("menolak desimal yang bukan .0", () => {
    const result = normalizeIdentifier("nik", "3322184301690004.5");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("decimal");
  });

  test("menolak nilai kosong", () => {
    const result = normalizeIdentifier("nik", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("empty");
  });

  test("No. RM boleh huruf dan tidak dipaksa 13/16 digit", () => {
    expect(expectValid("no_rm", "RM 000123")).toBe("RM000123");
    expect(expectValid("no_rm", "rm-99")).toBe("rm99");
  });
});

describe("detectIdentifierType", () => {
  test("16 digit -> nik", () => {
    expect(detectIdentifierType("3322184301690004")).toBe("nik");
  });

  test("13 digit -> bpjs", () => {
    expect(detectIdentifierType("0002612743929")).toBe("bpjs");
  });

  test("No. RM pendek -> no_rm", () => {
    expect(detectIdentifierType("023381")).toBe("no_rm");
  });

  test("spasi dan tanda hubung tidak mengubah hasil", () => {
    expect(detectIdentifierType(" 3322 1843 0169 0004 ")).toBe("nik");
    expect(detectIdentifierType("0002-6127-4392-9")).toBe("bpjs");
  });

  test("mengandung huruf -> no_rm walau panjangnya 16", () => {
    expect(detectIdentifierType("RM00000000000123")).toBe("no_rm");
    expect(detectIdentifierType("332218430169000X")).toBe("no_rm");
  });

  test("kosong -> no_rm", () => {
    expect(detectIdentifierType("   ")).toBe("no_rm");
  });
});
