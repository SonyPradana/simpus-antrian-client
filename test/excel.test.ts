import { describe, expect, test } from "bun:test";
import {
  buildPreview,
  detectHeaders,
  findHeaderRow,
  matchDoctor,
  matchHeader,
  matchPoscheck,
  normalizeHeader,
  normalizePoliId,
  pickIdentifier,
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
  test("mendeteksi ketiga kolom identitas sekaligus", () => {
    const mapping = detectHeaders(["No. RM", "No. BPJS", "NIK"]);
    expect(mapping.nik).toBe(2);
    expect(mapping.bpjs).toBe(1);
    expect(mapping.no_rm).toBe(0);
  });

  test("hanya mengisi jenis identitas yang kolomnya ada", () => {
    const mapping = detectHeaders(["No. BPJS", "Poli"]);
    expect(mapping.bpjs).toBe(0);
    expect(mapping.nik).toBeUndefined();
    expect(mapping.no_rm).toBeUndefined();
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
    expect(mapping.nik).toBeUndefined();
    expect(mapping.bpjs).toBeUndefined();
    expect(mapping.no_rm).toBeUndefined();
  });
});

describe("pickIdentifier", () => {
  const mapping = detectHeaders(["NIK", "No. BPJS", "No. RM", "Poli"]);
  // mapping: nik=0, bpjs=1, no_rm=2, poli=3

  test("auto memakai kolom yang terisi di baris itu", () => {
    expect(pickIdentifier(["3322184301690004", "", "", "89"], mapping)).toEqual({
      type: "nik",
      raw: "3322184301690004",
    });
    expect(pickIdentifier(["", "0002612743929", "", "89"], mapping)).toEqual({
      type: "bpjs",
      raw: "0002612743929",
    });
    expect(pickIdentifier(["", "", "RM000123", "89"], mapping)).toEqual({
      type: "no_rm",
      raw: "RM000123",
    });
  });

  test("auto memakai prioritas nik > bpjs > no_rm kalau dua kolom terisi", () => {
    expect(pickIdentifier(["3322184301690004", "0002612743929", "", "89"], mapping)?.type).toBe(
      "nik",
    );
  });

  test("mode tertentu hanya membaca kolom jenis itu", () => {
    expect(pickIdentifier(["", "0002612743929", "", "89"], mapping, "nik")).toBeNull();
    expect(pickIdentifier(["", "0002612743929", "", "89"], mapping, "bpjs")?.type).toBe("bpjs");
  });

  test("null kalau semua kolom identitas kosong", () => {
    expect(pickIdentifier(["", "", "", "89"], mapping)).toBeNull();
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

describe("matchPoscheck", () => {
  const poscheck = [
    { id: "01", nama: "Puskesmas Induk" },
    { id: "07", nama: "PUSTU BRANJANG" },
  ];

  test("cocok dengan nama server, case-insensitive", () => {
    expect(matchPoscheck("pustu branjang", poscheck)).toEqual({
      id: "07",
      nama: "PUSTU BRANJANG",
    });
  });

  test("menerima poscheck id", () => {
    expect(matchPoscheck("07", poscheck)?.nama).toBe("PUSTU BRANJANG");
  });

  test("nama di luar daftar server ditolak, bukan diteruskan apa adanya", () => {
    // "PKD NGABEN" adalah nama lokal lama yang sudah tidak ada di server.
    expect(matchPoscheck("PKD NGABEN", poscheck)).toBeNull();
    expect(matchPoscheck("", poscheck)).toBeNull();
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
    expect(preview.mapping.nik).toBe(0);
    expect(preview.mapping.poli).toBe(2);
  });
});
