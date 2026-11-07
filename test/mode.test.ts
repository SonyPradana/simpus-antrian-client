import { describe, expect, test } from "bun:test";
import { actionForLookup, identifierKey, lookupReasonLabel } from "@/shared/mode";
import { APMLookupResultSchema, APMQueueResultSchema } from "@/shared/schema";

function lookup(overrides: Record<string, unknown>) {
  return APMLookupResultSchema.parse(overrides);
}

describe("actionForLookup", () => {
  test("pasien aktif -> registration", () => {
    expect(actionForLookup(lookup({ mode: "existing_active", can_register: true }))).toBe(
      "registration",
    );
  });

  test("BPJS nonaktif -> blank walau can_register true", () => {
    expect(
      actionForLookup(lookup({ mode: "existing_inactive", can_register: true })),
    ).toBe("blank");
  });

  test("BPJS tidak pasti -> ikut can_register dari server", () => {
    expect(
      actionForLookup(lookup({ mode: "existing_bpjs_unknown", can_register: true })),
    ).toBe("registration");
    expect(
      actionForLookup(lookup({ mode: "existing_bpjs_unknown", can_register: false })),
    ).toBe("blank");
  });

  test("pasien baru -> blank", () => {
    expect(actionForLookup(lookup({ mode: "new" }))).toBe("blank");
  });
});

describe("identifierKey", () => {
  test("bpjs dipetakan ke no_bpjs, sisanya sama", () => {
    expect(identifierKey("bpjs")).toBe("no_bpjs");
    expect(identifierKey("nik")).toBe("nik");
    expect(identifierKey("no_rm")).toBe("no_rm");
  });
});

describe("lookupReasonLabel", () => {
  test("menerjemahkan reason yang dikenal", () => {
    expect(lookupReasonLabel("bpjs_inactive")).toContain("tidak aktif");
    expect(lookupReasonLabel("patient_not_found")).toContain("tidak ditemukan");
  });

  test("reason kosong -> null, reason asing dikembalikan apa adanya", () => {
    expect(lookupReasonLabel(undefined)).toBeNull();
    expect(lookupReasonLabel("")).toBeNull();
    expect(lookupReasonLabel("sesuatu_baru")).toBe("sesuatu_baru");
  });
});

describe("schema APM", () => {
  test("lookup mode new boleh tanpa patient/bpjs", () => {
    const parsed = APMLookupResultSchema.parse({
      mode: "new",
      can_register: false,
      fallback: "blank",
      reason: "patient_not_found",
    });
    expect(parsed.patient).toBeUndefined();
    expect(parsed.mode).toBe("new");
  });

  test("queue blank boleh tanpa patient dan needs_registration default false", () => {
    const parsed = APMQueueResultSchema.parse({
      mode: "blank",
      poli: { id: "05", nama: "Klaster 2 Ibu" },
      dokter: { kode_dokter: "45420", nama_dokter: "dr. Tuti Amalia" },
      antrian: { kode: "A001" },
    });
    expect(parsed.patient).toBeUndefined();
    expect(parsed.needs_registration).toBe(false);
  });
});
