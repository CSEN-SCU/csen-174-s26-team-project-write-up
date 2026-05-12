import { describe, expect, it, vi, afterEach } from "vitest";
import { documentJsonToPlainText, extractTextFromMcpPayload, resolveCoachDraftText } from "./google-docs-mcp.js";

describe("documentJsonToPlainText", () => {
  it("joins paragraph text runs", () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [{ textRun: { content: "Hello " } }, { textRun: { content: "world." } }],
            },
          },
        ],
      },
    };
    expect(documentJsonToPlainText(doc)).toBe("Hello world.");
  });
});

describe("extractTextFromMcpPayload", () => {
  it("reads documentText from nested result", () => {
    expect(
      extractTextFromMcpPayload({
        result: { documentText: "From MCP" },
      }),
    ).toBe("From MCP");
  });
});

describe("resolveCoachDraftText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_DOCS_ACCESS_TOKEN;
    delete process.env.GOOGLE_DOCS_MCP_BRIDGE_URL;
  });

  it("passes through text when use_mcp is false", async () => {
    const r = await resolveCoachDraftText({ text: "  hi  ", use_mcp: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("  hi  ");
  });

  it("returns 400 when use_mcp without doc_id", async () => {
    const r = await resolveCoachDraftText({ text: "", use_mcp: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("fetches via Google Docs API when token set", async () => {
    process.env.GOOGLE_DOCS_ACCESS_TOKEN = "test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            body: {
              content: [
                {
                  paragraph: {
                    elements: [{ textRun: { content: "API body" } }],
                  },
                },
              ],
            },
          }),
      }),
    );

    const r = await resolveCoachDraftText({
      use_mcp: true,
      doc_id: "abc123",
      text: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("API body");
    expect(fetch).toHaveBeenCalledWith(
      "https://docs.googleapis.com/v1/documents/abc123",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });
});
