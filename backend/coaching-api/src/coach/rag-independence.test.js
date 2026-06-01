import { describe, it, expect } from "vitest";
import { finalizeMechanicsSuggestions } from "./mechanics-pipeline.js";
import { mergeDeterministicAndCoaching } from "./merge-suggestions.js";
import { filterToCoachingOnly, isDeterministicCard } from "./issue-categories.js";

const FLAWED =
  "there is so many problems in this sentance. recieve the package in chicago. its a nice day.";

describe("RAG independence", () => {
  it("keeps deterministic findings when coaching merge is empty (no quoted-evidence strip)", () => {
    const deterministic = finalizeMechanicsSuggestions(FLAWED, "paused", 50);
    expect(deterministic.length).toBeGreaterThan(0);
    expect(deterministic.some(isDeterministicCard)).toBe(true);

    const merged = mergeDeterministicAndCoaching(deterministic, [], {
      userText: FLAWED,
      detMax: 80,
      coachMax: 30,
      totalMax: 100,
    });
    const detInMerged = merged.filter(isDeterministicCard);
    expect(detInMerged.length).toBeGreaterThan(0);
  });

  it("strips LLM grammar/spelling cards from coaching output", () => {
    const llm = [
      { type: "grammar", title: "Spelling: sentance", body: "Use sentence." },
      { type: "coherence", title: "Tone shift", body: "Register mixes." },
      { type: "clarity", title: "Vague word", body: "nice is weak." },
    ];
    const coaching = filterToCoachingOnly(llm);
    expect(coaching).toHaveLength(2);
    expect(coaching.some((c) => String(c.title).includes("Spelling"))).toBe(false);
  });
});
