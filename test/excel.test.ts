import { describe, expect, test } from "bun:test";
import {
  buildPreview,
  detectHeaders,
  findHeaderRow,
  matchDoctor,
  matchHeader,
  normalizeHeader,
  normalizePoliId,
  trimLeadingEmptyRows,
} from "@/shared/excel";

describe("normalizeHeader", () => {
  test("menlower-case dan merapikan tanda baca", () => {
    expect(normalizeHeader("No. RM")).toBe("no_rm");
    expect(normalizeHeader("NOMOR BPJS")).toBe("nomor_bpjs");
    expect(normalizeHeader("  NIK  ")).toBe("nik");
    expect(normalizeHeader("Nama Pasien!")).toBe("nama_pasien");
  });
});

describe("matchHeader", () => {
  test("mengenali NIK", () => {
    expect(matchHeader("NIK", "nik")).toBe(100);
    expect(matchHeader("No. NIK", "nik")).toBe(100);
    expect(matchHeader("NIK Pasien", "nik")).toBe(80);
  });

  test("tidak salah COLUMN BPJS sebagai NIK", () => {
    expect(matchHeader("No. BPJS", "nik")).toBeNull();
    expect(matchHeader("Nomor BPJS", "bpjs")).toBe(100);
  });

  test("mengenali No. RM", () => {
    expect(matchHeader("No RM", "no_rm")).toBe(100);
    expect(matchHeader("No. Rekam Medis", "no_rm")).toBe(95);
  });
});

describe("detectHeaders", () => {
  test("memilih satu kolom identitas dengan prioritas nik > bpjs > no_rm", () => {
    const mapping = detectHeaders(["No. RM", "No. BPJS", "NIK"]);
    expect(mapping.identifier).toBe(2);
    expect(mapping.identifierType).toBe("nik");
  });

  test("memakai bpjs kalau tidak ada nik", () => {
    const mapping = detectHeaders(["No. RM", "No. BPJS"]);
    expect(mapping.identifier).toBe(1);
    expect(mapping.identifierType).toBe("bpjs");
  });

  test("memakai no_rm sebagai pilihan terakhir", () => {
    const mapping = detectHeaders(["Nama", "No. RM"]);
    expect(mapping.identifier).toBe(1);
    expect(mapping.identifierType).toBe("no_rm");
  });

  test("mendeteksi kolom lain secara terpisah", () => {
    const mapping = detectHeaders(["NIK", "Poli", "Dokter", "Lokasi", "Petugas"]);
    expect(mapping.poli).toBe(1);
    expect(mapping.dokter).toBe(2);
    expect(mapping.lokasi).toBe(3);
    expect(mapping.tenaga).toBe(4);
  });

  test("tidak menemukan kolom identitas kalau tidak ada", () => {
    const mapping = detectHeaders(["Nama", "Alamat"]);
    expect(mapping.identifier).toBeUndefined();
    expect(mapping.identifierType).toBeUndefined();
  });
});

describe("normalizePoliId", () => {
  test("zero-pad ke 2 digit", () => {
    expect(normalizePoliId("5")).toBe("05");
    expect(normalizePoliId("05")).toBe("05");
    expect(normalizePoliId("89")).toBe("89");
  });

  test("kode non-numerik tetap apa adanya", () => {
    expect(normalizePoliId("P05")).toBe("P05");
    expect(normalizePoliId("  ")).toBe("");
  });
});

describe("matchDoctor", () => {
  const doctors = [
    { kode_dokter: "45420", nama_dokter: "dr. Tuti Amalia" },
    { kode_dokter: "51002", nama_dokter: "dr. Rina Kartika" },
  ];

  test("cocok persis dengan kode", () => {
    expect(matchDoctor("45420", doctors)).toBe("45420");
  });

  test("cocok case-insensitive dengan nama", () => {
    expect(matchDoctor("dr. rina kartika", doctors)).toBe("51002");
  });

  test("cocok sebagian dengan nama", () => {
    expect(matchDoctor("tuti", doctors)).toBe("45420");
  });

  test("null kalau tidak ada yang cocok", () => {
    expect(matchDoctor("dr. Tidak Ada", doctors)).toBeNull();
    expect(matchDoctor("", doctors)).toBeNull();
  });
});

describe("trimLeadingEmptyRows", () => {
  test("membuang baris kosong di atas", () => {
    const rows = [
      ["", ""],
      ["NIK", "Nama"],
      ["1", "Budi"],
    ];
    expect(trimLeadingEmptyRows(rows)).toEqual([
      ["NIK", "Nama"],
      ["1", "Budi"],
    ]);
  });
});

describe("findHeaderRow", () => {
  test("melewati baris judul dan mengambil baris header yang sebenarnya", () => {
    const rows = [
      ["LAPORAN PESERTA PESERTA KESEHATAN", ""],
      ["No", "NIK", "Nama", "Poli"],
      ["1", "123", "Budi", "05"],
    ];
    expect(findHeaderRow(rows)).toBe(1);
  });

  test("baris pertama kalau memang sudah header", () => {
    expect(findHeaderRow([["NIK", "Nama"]])).toBe(0);
  });
});

describe("buildPreview", () => {
  test("mengambil baris header yang benar dan mendeteksi pemetaan", () => {
    const preview = buildPreview([
      ["LAPORAN PESERTA", ""],
      ["NIK", "Nama", "Poli"],
      ["123", "Budi", "05"],
    ]);
    expect(preview.headers).toEqual(["NIK", "Nama", "Poli"]);
    expect(preview.rows).toEqual([["123", "Budi", "05"]]);
    expect(preview.mapping.identifier).toBe(0);
    expect(preview.mapping.identifierType).toBe("nik");
  });
});
