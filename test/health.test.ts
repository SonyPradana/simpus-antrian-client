import { afterEach, describe, expect, test } from "bun:test";
import { api } from "@/web/lib/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("api.health", () => {
  test("unwraps the BFF data envelope", async () => {
    const payload = {
      status: "ok",
      mock: false,
      apmConfigured: true,
      printBackendReady: true,
      printEnabled: true,
      hadirEnabled: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: payload }), {
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(api.health()).resolves.toEqual(payload);
  });
});
