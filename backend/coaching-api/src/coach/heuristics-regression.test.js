import { describe, it, expect } from "vitest";
import { finalizeMechanicsSuggestions } from "./mechanics-pipeline.js";

const TEST_CORPUS = `
yesterday i met sarah in chicago and we went to the museum it was closed so we walked around downtown and got lunch and then we went home and watched a movie and talked about our plans for next year
I wanted coffee, I was already late.
The project is behind schedule; because nobody submitted their work.
The weather was perfect: and everyone went hiking.
Words words words words words words words words words words.
The Dog ran through the Park and chased a Bird.
microsoft released a new product and i read about it while visiting paris.
Its been a weird day and your probably wondering why were here.
I am sooooo excited for this eventtttt.
The companyis growing quickly and we should meetafter lunch to discuss the results.
Please sendthe report before tomorrow.
I definately recieved the package.
We should of reviewed the document sooner.
Their going to announce the results tomorrow.
The dogs leash broke while we were walking.
The report was finished however nobody reviewed it
I bought apples oranges bananas and grapes.
I cant believe we forgot about the meeting.
my friend michael visited london after flying from canada.
Wait what are you doing
`.trim();

function issueTypes(cards) {
  return new Set(cards.map((c) => c.issueType).filter(Boolean));
}

describe("mechanics regression corpus", () => {
  const cards = finalizeMechanicsSuggestions(TEST_CORPUS, "paused", 80);
  const types = issueTypes(cards);

  it("detects core mechanics with confidence gate", () => {
    expect(cards.length).toBeGreaterThan(6);
    expect(cards.every((c) => (c.confidence ?? 0) >= 0.8)).toBe(true);
  });

  it("includes core issue categories", () => {
    expect(types.has("homophone")).toBe(true);
    expect(types.has("apostrophe")).toBe(true);
    expect(types.has("punctuation")).toBe(true);
    expect(types.has("spacing")).toBe(true);
    expect(types.has("spelling")).toBe(true);
    expect(types.has("capitalization")).toBe(true);
  });

  it("flags definately and proper nouns without chic ago", () => {
    expect(cards.some((c) => /definately/i.test(c.title))).toBe(true);
    expect(cards.some((c) => /chic ago/i.test(c.body || ""))).toBe(false);
    expect(cards.some((c) => c.micro_edit === "Chicago" || /chicago/i.test(c.title))).toBe(true);
  });

  it("flags should of, their going to, semicolon, and colon issues", () => {
    expect(cards.some((c) => /should of/i.test(c.title))).toBe(true);
    expect(cards.some((c) => /their going to/i.test(c.title))).toBe(true);
    expect(
      cards.some((c) => c.issueType === "punctuation" && /because/i.test(c.title)),
    ).toBe(true);
    expect(
      cards.some((c) => c.issueType === "punctuation" && /conjunction/i.test(c.title)),
    ).toBe(true);
  });
});
