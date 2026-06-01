import { describe, it, expect } from "vitest";
import { finalizeMechanicsSuggestions } from "./mechanics-pipeline.js";
import { isSerialNounList, isSemanticallyUnusualButValid } from "./mechanics-detect.js";

describe("precision rules", () => {
  it("does not treat clause 'and' as a serial list", () => {
    expect(isSerialNounList("perfect and everyone")).toBe(false);
    expect(isSerialNounList("apples oranges bananas and grapes")).toBe(true);
  });

  it("suppresses coaching for semantically unusual valid sentences", () => {
    const text = "Purple sandwiches negotiate silently with refrigerators.";
    expect(isSemanticallyUnusualButValid(text)).toBe(true);
    expect(finalizeMechanicsSuggestions(text, "paused", 20)).toEqual([]);
  });

  it("still runs mechanics on long drafts that contain a whimsical substring", () => {
    const text = `I definately recieved the package. happy teams negotiate budgets each quarter. ${"word ".repeat(200)}`;
    expect(isSemanticallyUnusualButValid(text)).toBe(false);
    const cards = finalizeMechanicsSuggestions(text, "paused", 40);
    expect(cards.some((c) => /definately/i.test(c.title))).toBe(true);
  });

  it("emits one New York entity card not chic ago", () => {
    const cards = finalizeMechanicsSuggestions("i visited new york last week", "paused", 10);
    expect(cards.some((c) => c.micro_edit === "New York")).toBe(true);
    expect(cards.some((c) => /chic ago/i.test(c.body || ""))).toBe(false);
  });

  it("prefers dog's leash over dogs leash", () => {
    const cards = finalizeMechanicsSuggestions(
      "The dogs leash broke while we were walking.",
      "paused",
      10,
    );
    const apostrophe = cards.find((c) => /dogs leash/i.test(c.title));
    expect(apostrophe?.micro_edit).toMatch(/dog's leash/i);
  });

  it("drops suggestions below 0.80 confidence", () => {
    const cards = finalizeMechanicsSuggestions("I am sooooo excited", "paused", 10);
    expect(cards.some((c) => c.issueType === "stretched_word")).toBe(false);
  });
});
