import { describe, expect, test } from "bun:test";
import { BatchExecutor, JobControl, JobEvents, buildBlankBody, buildRegistrationBody } from "@/server/batch";
import { AntrianApiError, type AntrianApi } from "@/server/antrian";
import { Store } from "@/server/db";
import { APMQueueResultSchema, type APMQueueBody, type APMQueueResult } from "@/shared/schema";
import type { QueueItem } from "@/shared/types";

function newStore(): Store {
  return new Store(":memory:");
}

function makeItem(store: Store, jobId: string, seq: number, overrides: Partial<QueueItem> = {}) {
  const item: QueueItem = {
    id: `item-${seq}`,
    jobId,
    seq,
    patient: { type: "nik", value: "3322184301690004" },
    patientName: "",
    poliId: "05",
    doctorCode: "45420",
    poscheckId: "06",
    lokasi: "PKD BANDARJO",
    tenaga: "44",
    fallback: false,
    status: "menunggu",
    queueCode: "",
    message: "",
    errorCode: "",
    sudah_terdaftar: false,
    ...overrides,
  };
  store.insertItems([item]);
  return item;
}

function result(code: string, mode: "registration" | "blank" = "registration"): APMQueueResult {
  return APMQueueResultSchema.parse({
    mode,
    needs_registration: mode === "blank",
    ...(mode === "registration"
      ? {
          patient: { no_rm: "RM000001", nama: "Siti Aminah", is_bpjs: false },
          bpjs: { is_bpjs: false, sumber: "local", terverifikasi: false },
        }
      : {}),
    poli: { id: "05", nama: "Klaster 2 Ibu", prefix: "A" },
    dokter: { kode_dokter: "45420", nama_dokter: "dr. Tuti Amalia" },
    antrian: { kode: code },
    dry_run: false,
  });
}

/** API tiruan: `behaviour` menentukan hasil per body queue. */
function fakeApi(behaviour: (body: APMQueueBody) => void = () => {}): AntrianApi {
  const notUsed = async () => {
    throw new Error("tidak dipakai di test ini");
  };
  return {
    listPoli: notUsed,
    listDoctors: notUsed,
    apmOptions: notUsed,
    apmLookup: notUsed,
    apmQueue: async (body) => {
      behaviour(body);
      return result(body.mode === "blank" ? "A001" : "A002", body.mode);
    },
  };
}

const options = { pcare: true };

describe("body builder", () => {
  const item = {
    id: "x",
    jobId: "j",
    seq: 0,
    patient: { type: "nik" as const, value: "3322184301690004" },
    patientName: "",
    poliId: "05",
    doctorCode: "45420",
    poscheckId: "06",
    lokasi: "PKD BANDARJO",
    tenaga: "44",
    fallback: false,
    status: "menunggu" as const,
    queueCode: "",
    message: "",
    errorCode: "",
    sudah_terdaftar: false,
  };

  test("registration membawa identifier, petugas, dan poscheck - tanpa lokasi", () => {
    const body = buildRegistrationBody(item, true);
    expect(body.mode).toBe("registration");
    expect(body.nik).toBe("3322184301690004");
    expect(body.petugas_id).toBe("44");
    expect(body.poscheck_id).toBe("06");
    expect(body.pcare).toBe(true);
    expect("lokasi" in body).toBe(false);
  });

  test("blank tidak membawa identifier dan petugas_id (ditolak server)", () => {
    const body = buildBlankBody(item);
    expect(body.mode).toBe("blank");
    expect("nik" in body).toBe(false);
    expect("no_bpjs" in body).toBe(false);
    expect("no_rm" in body).toBe(false);
    expect("petugas_id" in body).toBe(false);
    expect(body.poscheck_id).toBe("06");
  });
});

describe("BatchExecutor", () => {
  test("item sukses -> status sukses + nomor antrian + nama pasien", async () => {
    const store = newStore();
    const job = store.createJob("job-1", "input", false);
    makeItem(store, job.id, 0);

    const executor = new BatchExecutor(store, fakeApi(), new JobEvents(), options);
    await executor.run(job.id, new JobControl());

    const [item] = store.listItems(job.id);
    expect(item?.status).toBe("sukses");
    expect(item?.queueCode).toBe("A002");
    expect(item?.patientName).toBe("Siti Aminah");
  });

  test("nama lokasi diambil dari response server, bukan label yang dipilih di client", async () => {
    const store = newStore();
    const job = store.createJob("job-lokasi", "input", false);
    // client memilih label lama/basi; server yang menentukan nama sebenarnya
    makeItem(store, job.id, 0, { poscheckId: "07", lokasi: "PKD NGABEN" });

    const api = fakeApi();
    const original = api.apmQueue;
    api.apmQueue = async (body) => ({
      ...(await original(body)),
      poscheck_id: "07",
      lokasi: "PUSTU BRANJANG",
    });

    const executor = new BatchExecutor(store, api, new JobEvents(), options);
    await executor.run(job.id, new JobControl());

    const [item] = store.listItems(job.id);
    expect(item?.lokasi).toBe("PUSTU BRANJANG");
    expect(item?.poscheckId).toBe("07");
  });

  test("pasien tidak ditemukan + fallback aktif -> mode blank", async () => {
    const store = newStore();
    const job = store.createJob("job-2", "input", true);
    makeItem(store, job.id, 0, { fallback: true });

    const modes: string[] = [];
    const executor = new BatchExecutor(
      store,
      fakeApi((body) => {
        modes.push(body.mode);
        if (body.mode === "registration") {
          throw new AntrianApiError("PATIENT_NOT_FOUND", 404, "pasien tidak ditemukan");
        }
      }),
      new JobEvents(),
      options,
    );
    await executor.run(job.id, new JobControl());

    const [item] = store.listItems(job.id);
    expect(item?.status).toBe("sukses");
    expect(item?.queueCode).toBe("A001");
    expect(modes).toEqual(["registration", "blank"]);
  });

  test("pasien tidak ditemukan + fallback mati -> gagal, bukan sukses", async () => {
    const store = newStore();
    const job = store.createJob("job-3", "input", false);
    makeItem(store, job.id, 0, { fallback: false });

    const executor = new BatchExecutor(
      store,
      fakeApi(() => {
        throw new AntrianApiError("PATIENT_NOT_FOUND", 404, "pasien tidak ditemukan");
      }),
      new JobEvents(),
      options,
    );
    await executor.run(job.id, new JobControl());

    const [item] = store.listItems(job.id);
    expect(item?.status).toBe("gagal");
    expect(item?.errorCode).toBe("PATIENT_NOT_FOUND");
    expect(item?.queueCode).toBe("");
  });

  test("ALREADY_REGISTERED -> tetap sukses, ambil nomor antrian yang sudah ada", async () => {
    const store = newStore();
    const job = store.createJob("job-4", "input", false);
    makeItem(store, job.id, 0);

    const executor = new BatchExecutor(
      store,
      fakeApi(() => {
        throw new AntrianApiError(
          "ALREADY_REGISTERED",
          409,
          "pasien sudah terdaftar",
          result("G017"),
        );
      }),
      new JobEvents(),
      options,
    );
    await executor.run(job.id, new JobControl());

    const [item] = store.listItems(job.id);
    expect(item?.status).toBe("sukses");
    expect(item?.sudah_terdaftar).toBe(true);
    expect(item?.queueCode).toBe("G017");
  });

  test("error domain lain -> gagal dengan kode error tersimpan", async () => {
    const store = newStore();
    const job = store.createJob("job-5", "input", false);
    makeItem(store, job.id, 0);

    const executor = new BatchExecutor(
      store,
      fakeApi(() => {
        throw new AntrianApiError("QUOTA_EXCEEDED", 422, "kapasitas dokter habis");
      }),
      new JobEvents(),
      options,
    );
    await executor.run(job.id, new JobControl());

    const [item] = store.listItems(job.id);
    expect(item?.status).toBe("gagal");
    expect(item?.errorCode).toBe("QUOTA_EXCEEDED");
  });

  test("satu item gagal tidak menghentikan item berikutnya", async () => {
    const store = newStore();
    const job = store.createJob("job-6", "input", false);
    makeItem(store, job.id, 0, { patient: { type: "nik", value: "bad" } });
    makeItem(store, job.id, 1, { patient: { type: "nik", value: "good" } });

    const executor = new BatchExecutor(
      store,
      fakeApi((body) => {
        if (body.nik === "bad") throw new AntrianApiError("QUOTA_EXCEEDED", 422, "penuh");
      }),
      new JobEvents(),
      options,
    );
    await executor.run(job.id, new JobControl());

    const items = store.listItems(job.id);
    expect(items[0]?.status).toBe("gagal");
    expect(items[1]?.status).toBe("sukses");
  });

  test("urutan eksekusi mengikuti urutan baris (seq)", async () => {
    const store = newStore();
    const job = store.createJob("job-7", "input", false);
    makeItem(store, job.id, 0, { patient: { type: "nik", value: "a" } });
    makeItem(store, job.id, 1, { patient: { type: "nik", value: "b" } });

    const seen: string[] = [];
    const executor = new BatchExecutor(
      store,
      fakeApi((body) => {
        seen.push(body.nik ?? "");
      }),
      new JobEvents(),
      options,
    );
    await executor.run(job.id, new JobControl());

    expect(seen).toEqual(["a", "b"]);
  });
});

describe("JobControl", () => {
  test("stop menghentikan eksekusi", async () => {
    const control = new JobControl();
    control.stop();
    expect(control.isStopped).toBe(true);
    await control.waitWhilePaused();
  });
});
