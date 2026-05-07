import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("apiFetch", () => {
  it("throws ApiError on 4xx so writes never silently succeed", async () => {
    mockFetch(jsonResponse({ error: "missing_user_or_doc" }, { ok: false, status: 400 }));

    await expect(
      apiFetch("/api/feedback-history", { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "missing_user_or_doc",
    });
  });

  it("returns the fallback for safe GETs when the server is 5xx", async () => {
    mockFetch(jsonResponse({ error: "firestore_unavailable" }, { ok: false, status: 503 }));

    const fallback = { items: [], degraded: true, error: "offline" };
    const result = await apiFetch("/api/feedback-history", { fallback });

    expect(result).toEqual(fallback);
  });

  it("propagates network failures as ApiError when no fallback is provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await expect(apiFetch("/api/users/me", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
  });
});
