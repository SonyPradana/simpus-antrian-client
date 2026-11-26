import { describe, expect, test } from "bun:test";
import {
  classifyHadir,
  createDisabledLoketApi,
  createLoketApi,
  LoketApiError,
} from "@/server/loket";
import { buildLoketPayload, dataUnitFor, validateHadir } from "@/shared/loket";

const config = {
  baseUrl: "http://example.test/antrian/index.php/Antrian",
  unitId: "99",
  timeoutMs: 1000,
};

const hadirInput = {
  kode: "A004",
  poli: "Lintas Klaster Gigi",
  noKartu: "0002270850862",
  namaProvider: "Klinik Gracia",
};

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(handler: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(input), init };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

function getHeader(call: Call | undefined, name: string): string | undefined {
  const headers = call?.init?.headers as Record<string, string> | undefined;
  return headers?.[name];
}

async function expectLoketError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`expected LoketApiError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(LoketApiError);
    expect((error as LoketApiError).code).toBe(code);
  }
}

/** Simulates the two hydration GETs followed by POST /Hadir. */
function hydrateThenPost(postResponse: Response) {
  return fakeFetch((_call, index) => {
    if (index === 0) {
      return new Response("", {
        headers: { "Set-Cookie": "ci_session=root-session; path=/" },
      });
    }
    if (index === 1) {
      return new Response("", {
        headers: { "Set-Cookie": "ci_session=final-session; path=/" },
      });
    }
    return postResponse;
  });
}

describe("buildLoketPayload", () => {
  test("sends exactly the four verified fields with encoded spaces", () => {
    const payload = buildLoketPayload(
      { kode: " B001 ", poli: "Lintas Klaster Gigi" },
      { unitId: "99" },
    );
    expect([...payload.keys()]).toEqual(["kode", "unit", "poli", "unitId"]);
    expect(payload.toString()).toBe(
      "kode=B001&unit=Pendaftaran&poli=Lintas+Klaster+Gigi&unitId=99",
    );
  });

  test("rejects an empty queue code but always uses the hardcoded unit", () => {
    expect(() => buildLoketPayload({ kode: " " }, { unitId: "99" })).toThrow();
    expect(buildLoketPayload({ kode: "B001" }, { unitId: "96" }).get("unit")).toBe(
      "Pendaftaran",
    );
  });
});

describe("dataUnitFor", () => {
  test("maps known unit ids and falls back to the default", () => {
    expect(dataUnitFor("99")).toBe("Pendaftaran_1");
    expect(dataUnitFor("96")).toBe("Pendaftaran_2");
    expect(dataUnitFor("88")).toBe("Pendaftaran_3");
    expect(dataUnitFor(" 99 ")).toBe("Pendaftaran_1");
    expect(dataUnitFor("42")).toBe("Pendaftaran_1");
  });
});

describe("validateHadir", () => {
  test("rejects a missing BPJS number before any HTTP call", () => {
    const result = validateHadir({ noKartu: "", namaProvider: "Klinik Gracia" });
    expect(result).toMatchObject({ ok: false, code: "NO_KARTU_KOSONG" });
  });

  test("trims the provider name and accepts a valid one", () => {
    expect(validateHadir({ noKartu: " 0002270850862 ", namaProvider: " Klinik Gracia " })).toEqual({
      ok: true,
    });
  });

  test("rejects empty and sentinel provider names with the external messages", () => {
    const empty = validateHadir({ noKartu: "0002270850862", namaProvider: "  " });
    expect(empty).toMatchObject({ ok: false, code: "FASKES_KOSONG" });
    if (!empty.ok) expect(empty.message).toContain("Silahkan Lakukan Sinkronisasi");

    for (const name of ["lbl_namaprovider", "Tidak Ada", " Tidak Ada "]) {
      const invalid = validateHadir({ noKartu: "0002270850862", namaProvider: name });
      expect(invalid).toMatchObject({ ok: false, code: "FASKES_TIDAK_SESUAI" });
      if (!invalid.ok) expect(invalid.message).toContain("APM Touch");
    }
  });
});

describe("classifyHadir", () => {
  test("treats HTTP-independent success text as sent", () => {
    expect(classifyHadir("Anda Telah Mengirim Hadir No Antrian C008.", "C008")).toEqual({
      ok: true,
    });
  });

  test("keeps success when the local log fails", () => {
    expect(
      classifyHadir(
        "Anda Telah Mengirim Hadir No Antrian C008. Database Error Column 'visit_id' cannot be null",
        "C008",
      ),
    ).toEqual({ ok: true, warning: "log_lokal_gagal" });
  });

  test("keeps success when PCARE rejects a duplicate", () => {
    expect(
      classifyHadir(
        "Anda Telah Mengirim Hadir No Antrian A004. Gagal mengirim ke PCARE BPJS HTTP Code: 412",
        "A004",
      ),
    ).toEqual({ ok: true, warning: "pcare_sudah_terdaftar" });
  });

  test("flags a lost session as retryable and an invalid faskes as final", () => {
    expect(classifyHadir("Data BPJS tidak ditemukan di session", "C021")).toMatchObject({
      ok: false,
      retrySession: true,
    });
    expect(
      classifyHadir("kdProviderPeserta tidak ditemukan di data kunjungan", "C021"),
    ).toMatchObject({ ok: false, code: "HADIR_INVALID_FASKES" });
    expect(classifyHadir("<h1>Something else</h1>", "C021")).toMatchObject({
      ok: false,
      code: "HADIR_FAILED",
    });
  });
});

describe("createLoketApi.print", () => {
  test("posts the verified form to /CetakAntrian and accepts a static 200", async () => {
    const { calls, fetchImpl } = fakeFetch(
      () => new Response("<div class='alert alert-info'>Cetak Antrian</div>", { status: 200 }),
    );
    const api = createLoketApi(config, fetchImpl);

    const result = await api.print({ kode: "B001", poli: "Lintas Klaster Gigi" });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${config.baseUrl}/CetakAntrian`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      "kode=B001&unit=Pendaftaran&poli=Lintas+Klaster+Gigi&unitId=99",
    );
  });
});

describe("createLoketApi.hadir", () => {
  test("hydrates ci_session, follows redirects, and sends only the four fields", async () => {
    const { calls, fetchImpl } = hydrateThenPost(
      new Response("Anda Telah Mengirim Hadir No Antrian A004."),
    );
    const api = createLoketApi(config, fetchImpl);

    const result = await api.hadir(hadirInput);

    expect(result).toEqual({ ok: true, state: "terkirim" });
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url).toBe("http://example.test/antrian/");
    expect(calls[1]?.url).toBe(
      "http://example.test/antrian/index.php/Antrian/DataFingerUnit/99/Pendaftaran_1",
    );
    expect(getHeader(calls[1], "Cookie")).toBe("ci_session=root-session");
    expect(calls[2]?.url).toBe(`${config.baseUrl}/Hadir`);
    expect(getHeader(calls[2], "Cookie")).toBe("ci_session=final-session");
    expect(calls[2]?.init?.redirect).toBe("follow");
    expect(calls[2]?.init?.body).toBe(
      "kode=A004&unit=Pendaftaran&poli=Lintas+Klaster+Gigi&unitId=99",
    );
    expect(calls[2]?.init?.body).not.toContain("noKartu");
    expect(calls[2]?.init?.body).not.toContain("namaProvider");
  });

  test("returns pcare warning without retrying after a duplicate", async () => {
    const { calls, fetchImpl } = hydrateThenPost(
      new Response(
        "Anda Telah Mengirim Hadir No Antrian A004. Gagal mengirim ke PCARE BPJS: sudah di-entri. HTTP Code: 412",
      ),
    );
    const api = createLoketApi(config, fetchImpl);

    const result = await api.hadir(hadirInput);

    expect(result).toEqual({ ok: true, state: "terkirim", warning: "pcare_sudah_terdaftar" });
    expect(calls).toHaveLength(3);
  });

  test("returns a local-log warning for HTTP 500 with a success message", async () => {
    const { calls, fetchImpl } = hydrateThenPost(
      new Response(
        "Anda Telah Mengirim Hadir No Antrian C008. A Database Error Occurred Column 'visit_id' cannot be null",
        { status: 500 },
      ),
    );
    const api = createLoketApi(config, fetchImpl);

    const result = await api.hadir({ ...hadirInput, kode: "C008" });

    expect(result).toEqual({ ok: true, state: "terkirim", warning: "log_lokal_gagal" });
    expect(calls).toHaveLength(3);
  });

  test("refreshes the session at most once when BPJS data is missing", async () => {
    const responses = [
      new Response("", { headers: { "Set-Cookie": "ci_session=first" } }),
      new Response("", { headers: { "Set-Cookie": "ci_session=first" } }),
      new Response("Data BPJS tidak ditemukan di session"),
      new Response("", { headers: { "Set-Cookie": "ci_session=second" } }),
      new Response("", { headers: { "Set-Cookie": "ci_session=second" } }),
      new Response("Anda Telah Mengirim Hadir No Antrian A004."),
    ];
    const { calls, fetchImpl } = fakeFetch((_call, index) => responses[index] as Response);
    const api = createLoketApi(config, fetchImpl);

    const result = await api.hadir(hadirInput);

    expect(result).toEqual({ ok: true, state: "terkirim" });
    expect(calls).toHaveLength(6);
    expect(getHeader(calls[3], "Cookie")).toBeUndefined();
    expect(getHeader(calls[4], "Cookie")).toBe("ci_session=second");
    expect(getHeader(calls[5], "Cookie")).toBe("ci_session=second");
  });

  test("fails after one retry when the session is still missing", async () => {
    const { calls, fetchImpl } = fakeFetch((_call, index) => {
      if (index % 3 === 2) return new Response("Data BPJS tidak ditemukan di session");
      return new Response("", { headers: { "Set-Cookie": "ci_session=session" } });
    });
    const api = createLoketApi(config, fetchImpl);

    await expectLoketError(api.hadir(hadirInput), "HADIR_SESSION_FAILED");
    expect(calls).toHaveLength(6);
  });

  test("does not retry an invalid faskes response", async () => {
    const { calls, fetchImpl } = hydrateThenPost(
      new Response("kdProviderPeserta tidak ditemukan di data kunjungan"),
    );
    const api = createLoketApi(config, fetchImpl);

    await expectLoketError(api.hadir(hadirInput), "HADIR_INVALID_FASKES");
    expect(calls).toHaveLength(3);
  });

  test("fails a 500 response with no success message", async () => {
    const { calls, fetchImpl } = hydrateThenPost(new Response("Server error", { status: 500 }));
    const api = createLoketApi(config, fetchImpl);

    await expectLoketError(api.hadir(hadirInput), "HADIR_FAILED");
    expect(calls).toHaveLength(3);
  });

  test("rejects invalid BFF input before making a request", async () => {
    const { calls, fetchImpl } = fakeFetch(() => new Response("unexpected"));
    const api = createLoketApi(config, fetchImpl);

    await expectLoketError(api.hadir({ ...hadirInput, noKartu: "" }), "HADIR_INVALID");
    expect(calls).toHaveLength(0);
  });
});

describe("createDisabledLoketApi", () => {
  test("skips both actions without calling fetch", async () => {
    const api = createDisabledLoketApi();
    await expect(api.print({ kode: "B001", poli: "" })).resolves.toEqual({
      ok: true,
      skipped: true,
    });
    await expect(api.hadir(hadirInput)).resolves.toEqual({ ok: true, skipped: true });
  });
});
