import { describe, expect, it } from "vitest";
import { summarizeDraftsIndex } from "./index.js";

describe("summarizeDraftsIndex", () => {
  it("maps draft rows to index entries without full text", () => {
    const idx = summarizeDraftsIndex([
      { id: "a", createdAt: "2026-01-01T00:00:00.000Z", text: "hello world", source: "user-draft-history" },
    ]);
    expect(idx).toEqual([
      {
        id: "a",
        createdAt: "2026-01-01T00:00:00.000Z",
        charCount: 11,
        source: "user-draft-history",
      },
    ]);
  });

  it("handles missing drafts array", () => {
    expect(summarizeDraftsIndex(undefined)).toEqual([]);
    expect(summarizeDraftsIndex(null)).toEqual([]);
  });
});
