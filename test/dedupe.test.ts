import { describe, expect, test } from "bun:test";
import { duplicateKey, partitionDuplicates, type DuplicateCandidate } from "@/shared/dedupe";

function candidate(overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    identifierType: "nik",
    identifierValue: "3322184301690004",
    poliId: "05",
    doctorCode: "45420",
    ...overrides,
  };
}

describe("duplicateKey", () => {
  test("mengabaikan spasi dan besar-kecil huruf", () => {
    expect(duplicateKey(candidate({ identifierValue: " 3322184301690004 " }))).toBe(
      duplicateKey(candidate()),
    );
  });

  test("poli berbeda menghasilkan kunci berbeda", () => {
    expect(duplicateKey(candidate({ poliId: "05" }))).not.toBe(
      duplicateKey(candidate({ poliId: "20" })),
    );
  });

  test("dokter berbeda menghasilkan kunci berbeda", () => {
    expect(duplicateKey(candidate({ doctorCode: "45420" }))).not.toBe(
      duplicateKey(candidate({ doctorCode: "51002" })),
    );
  });
});

describe("partitionDuplicates", () => {
  test("menolak baris yang sama persis dengan isi tabel", () => {
    const { accepted, rejected } = partitionDuplicates([candidate()], [candidate()]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  test("menolak duplikat di dalam batch baru itu sendiri", () => {
    const { accepted, rejected } = partitionDuplicates([candidate(), candidate()]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  test("pasien sama di poli berbeda tetap diterima", () => {
    const { accepted, rejected } = partitionDuplicates(
      [candidate({ poliId: "20" })],
      [candidate({ poliId: "05" })],
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  test("pasien sama, poli sama, dokter berbeda tetap diterima", () => {
    const { accepted, rejected } = partitionDuplicates(
      [candidate({ doctorCode: "51002" })],
      [candidate({ doctorCode: "45420" })],
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  test("identitas berbeda dengan poli sama tetap diterima", () => {
    const { accepted } = partitionDuplicates(
      [candidate({ identifierValue: "3322184301690005" })],
      [candidate()],
    );
    expect(accepted).toHaveLength(1);
  });

  test("urutan baris yang diterima tidak berubah", () => {
    const first = candidate({ identifierValue: "1111111111111111" });
    const second = candidate({ identifierValue: "2222222222222222" });
    const { accepted } = partitionDuplicates([first, second]);
    expect(accepted.map((item) => item.identifierValue)).toEqual([
      "1111111111111111",
      "2222222222222222",
    ]);
  });
});
