/**
 * Implementasi `AntrianApi` dari fixture lokal (facade APM).
 *
 * TUJUAN: memungkinkan seluruh UI & alur batch dikembangkan dan diverifikasi
 * tanpa Go API hidup. Fixture ini juga memaksa bentuk data mengikuti
 * `schema.ts` (semua data dibuat lewat `.parse()`), jadi tidak mungkin
 * menyimpang dari kontrak.
 *
 * Simulasi error memakai penanda angka di identifier, karena NIK/BPJS wajib
 * digit (lihat shared/identifier.ts):
 *   - berakhiran "9"     -> lookup `new`, registration PATIENT_NOT_FOUND
 *   - mengandung "6666"  -> lookup `existing_inactive` (BPJS nonaktif)
 *   - mengandung "7777"  -> ALREADY_REGISTERED
 *   - mengandung "8888"  -> QUOTA_EXCEEDED
 */
import {
  APMLookupResultSchema,
  APMOptionsSchema,
  APMQueueResultSchema,
  DoctorSchema,
  PoliSchema,
} from "@/shared/schema";
import type {
  APMLookupResult,
  APMOptions,
  APMQueueBody,
  APMQueueResult,
  Doctor,
  DoctorList,
  Patient,
  PatientRef,
  Poli,
  Queue,
} from "@/shared/schema";
import { AntrianApiError, type AntrianApi } from "./antrian";

const POLI = PoliSchema.array().parse([
  {
    id: "05",
    kode_antrian: "05",
    unit_id: "05",
    nama: "Klaster 2 Ibu",
    kode_bpjs: "P0005",
    poli_sakit: false,
    prefix: "A",
    total_antrian: 12,
  },
  {
    id: "20",
    kode_antrian: "20",
    unit_id: "20",
    nama: "Klaster 1 Anak",
    kode_bpjs: "P0020",
    poli_sakit: false,
    prefix: "B",
    total_antrian: 7,
  },
  {
    id: "89",
    kode_antrian: "89",
    unit_id: "89",
    nama: "Poli Umum",
    kode_bpjs: "P0089",
    poli_sakit: true,
    prefix: "G",
    total_antrian: 31,
  },
]);

const DOCTORS: Record<string, Doctor[]> = {
  "05": DoctorSchema.array().parse([
    {
      kode_dokter: "45420",
      nama_dokter: "dr. Tuti Amalia",
      jam_praktek: "07:30-12:00",
      kapasitas: 18,
      kode_poli: "P0005",
    },
  ]),
  "20": DoctorSchema.array().parse([
    {
      kode_dokter: "51002",
      nama_dokter: "dr. Rina Kartika",
      jam_praktek: "08:00-11:00",
      kapasitas: 24,
      kode_poli: "P0020",
    },
    {
      kode_dokter: "51003",
      nama_dokter: "dr. Bayu Nugroho",
      jam_praktek: "13:00-16:00",
      kapasitas: 20,
      kode_poli: "P0020",
    },
  ]),
  "89": DoctorSchema.array().parse([
    {
      kode_dokter: "76232",
      nama_dokter: "dr. Siti Aminah",
      jam_praktek: "07:00-14:00",
      kapasitas: 40,
      kode_poli: "P0089",
    },
    {
      kode_dokter: "76233",
      nama_dokter: "dr. Joko Purnomo",
      jam_praktek: "14:00-20:00",
      kapasitas: 35,
      kode_poli: "P0089",
    },
    {
      kode_dokter: "76234",
      nama_dokter: "dr.Mega Lestari",
      jam_praktek: "19:00-22:00",
      kapasitas: 15,
      kode_poli: "P0089",
    },
  ]),
};

const OPTIONS: APMOptions = APMOptionsSchema.parse({
  petugas: [
    { id: "44", nama: "Siti Rahmawati" },
    { id: "45", nama: "Andi Prasetyo" },
  ],
  poscheck: [
    { id: "06", nama: "PKD BANDARJO" },
    { id: "07", nama: "PKD NGABEN" },
  ],
  terpilih: {
    petugas_id: "44",
    poscheck_id: "06",
    lokasi: "PKD BANDARJO",
  },
});

const PATIENT: Patient = {
  no_rm: "RM000123",
  nama: "Siti Aminah",
  nama_kk: "Siti Aminah",
  alamat: "Jl. Merdeka No. 12",
  tanggal_lahir: "1990-05-14",
  nik: "3322184301690004",
  no_bpjs: "0002612743929",
  is_bpjs: true,
  gakin: false,
  bayar: false,
  jenis_pasien: "BPJS",
};

const delay = (ms = 60) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let queueCounter = 40;

function nextQueue(poli: Poli): Queue {
  queueCounter += 1;
  return {
    kode: `${poli.prefix}${String(queueCounter % 1000).padStart(3, "0")}`,
    no_urut_poli: queueCounter % 50,
    no_urut: queueCounter,
    tanggal: new Date().toISOString().slice(0, 10),
    poli: poli.nama,
    dokter: "",
    kode_dokter: "",
    menunggu_di_depan: queueCounter % 5,
    sisa_kuota: Math.max(0, 30 - (queueCounter % 50)),
  };
}

function findPoli(poliId: string): Poli {
  const poli = POLI.find((item) => item.id === poliId);
  if (!poli) {
    throw new AntrianApiError("POLI_NOT_FOUND", 404, "poli tidak ditemukan atau tidak aktif");
  }
  return poli;
}

function pickDoctor(poliId: string, code: string | undefined): Doctor {
  const doctors = DOCTORS[poliId] ?? [];
  if (!code) {
    const first = doctors[0];
    if (!first) {
      throw new AntrianApiError("DOCTOR_NOT_FOUND", 404, "dokter tidak tersedia");
    }
    return first;
  }
  const doctor = doctors.find((item) => item.kode_dokter === code);
  if (!doctor) {
    throw new AntrianApiError("DOCTOR_NOT_FOUND", 404, "dokter tidak tersedia");
  }
  return doctor;
}

function identifierOf(body: APMQueueBody): string {
  return body.nik ?? body.no_bpjs ?? body.no_rm ?? "";
}

function locationOf(body: APMQueueBody): { poscheck_id: string; lokasi: string } {
  const poscheckId = body.poscheck_id ?? OPTIONS.terpilih.poscheck_id;
  const match = OPTIONS.poscheck.find((item) => item.id === poscheckId);
  if (!match) {
    throw new AntrianApiError("POSCHECK_NOT_FOUND", 404, "lokasi pendaftaran tidak ditemukan");
  }
  return { poscheck_id: match.id, lokasi: match.nama };
}

export function createMockApi(): AntrianApi {
  return {
    async listPoli(): Promise<Poli[]> {
      await delay();
      return POLI;
    },

    async listDoctors(poliId: string): Promise<DoctorList> {
      await delay();
      const poli = findPoli(poliId);
      const dokter = DOCTORS[poliId] ?? [];
      return {
        poli,
        dokter,
        otomatis: dokter.length === 1,
        dipilih: dokter.length === 1 ? dokter[0] : undefined,
      };
    },

    async apmOptions(): Promise<APMOptions> {
      await delay();
      return OPTIONS;
    },

    async apmLookup(ref: PatientRef, _pcare: boolean): Promise<APMLookupResult> {
      await delay();
      const value = ref.value.trim();

      if (value.endsWith("9")) {
        return APMLookupResultSchema.parse({
          mode: "new",
          can_register: false,
          fallback: "blank",
          reason: "patient_not_found",
        });
      }

      if (value.includes("6666")) {
        return APMLookupResultSchema.parse({
          mode: "existing_inactive",
          can_register: false,
          fallback: "blank",
          reason: "bpjs_inactive",
          patient: PATIENT,
          bpjs: {
            is_bpjs: true,
            no_kartu: "0002612743929",
            sumber: "local",
            terverifikasi: false,
            aktif: false,
            status: "Nonaktif",
          },
        });
      }

      return APMLookupResultSchema.parse({
        mode: "existing_active",
        can_register: true,
        patient: { ...PATIENT, no_rm: `RM${value.slice(-6).padStart(6, "0")}` },
        bpjs: {
          is_bpjs: true,
          no_kartu: "0002612743929",
          sumber: "local",
          terverifikasi: false,
          aktif: true,
          status: "Aktif",
        },
      });
    },

    async apmQueue(body: APMQueueBody): Promise<APMQueueResult> {
      await delay(120);
      const poli = findPoli(body.poli_id);
      const doctor = pickDoctor(poli.id, body.kode_dokter);
      const location = locationOf(body);

      if (body.mode === "blank") {
        if (identifierOf(body) !== "" || (body.petugas_id ?? "") !== "") {
          throw new AntrianApiError(
            "INVALID_INPUT",
            400,
            "identitas dan petugas_id tidak boleh diisi untuk mode blank",
          );
        }
        return APMQueueResultSchema.parse({
          mode: "blank",
          needs_registration: true,
          poli,
          dokter: doctor,
          antrian: {
            ...nextQueue(poli),
            dokter: doctor.nama_dokter,
            kode_dokter: doctor.kode_dokter,
          },
          poscheck_id: location.poscheck_id,
          lokasi: location.lokasi,
          dry_run: false,
        });
      }

      const identifier = identifierOf(body);
      if (identifier === "") {
        throw new AntrianApiError(
          "INVALID_INPUT",
          400,
          "mode registration butuh tepat satu identitas",
        );
      }
      if (identifier.endsWith("9")) {
        throw new AntrianApiError("PATIENT_NOT_FOUND", 404, "pasien tidak ditemukan");
      }
      if (identifier.includes("8888")) {
        throw new AntrianApiError("QUOTA_EXCEEDED", 422, "kapasitas dokter habis");
      }

      const result = APMQueueResultSchema.parse({
        mode: "registration",
        needs_registration: false,
        patient: { ...PATIENT, no_rm: `RM${identifier.slice(-6).padStart(6, "0")}` },
        bpjs: {
          is_bpjs: true,
          no_kartu: "0002612743929",
          sumber: "local",
          terverifikasi: true,
          aktif: true,
          status: "Aktif",
        },
        poli,
        dokter: doctor,
        antrian: {
          ...nextQueue(poli),
          dokter: doctor.nama_dokter,
          kode_dokter: doctor.kode_dokter,
        },
        petugas_id: body.petugas_id ?? OPTIONS.terpilih.petugas_id,
        poscheck_id: location.poscheck_id,
        lokasi: location.lokasi,
        visit_id: Math.floor(Math.random() * 100000),
        dry_run: false,
      });

      if (identifier.includes("7777")) {
        throw new AntrianApiError(
          "ALREADY_REGISTERED",
          409,
          "pasien sudah terdaftar hari ini",
          {
            ...result,
            antrian: { ...result.antrian, kode: "G017" },
            sudah_terdaftar: true,
          },
        );
      }

      return result;
    },
  };
}
