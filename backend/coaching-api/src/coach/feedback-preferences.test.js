import { describe, expect, it } from "vitest";
import {
  applyFeedbackPreferences,
  buildPreferenceModel,
  normalizeIssueKey,
  shouldSuppressSuggestion,
} from "./feedback-preferences.js";

describe("feedback-preferences", () => {
  const preferences = {
    accepted: [{ category: "grammar", issue: 'Grammar: "your welcome"' }],
    declined: [{ category: "spelling", issue: 'Spelling: "teh"' }],
    categoryScores: {
      spelling: { accepted: 0, declined: 3 },
      grammar: { accepted: 4, declined: 0 },
    },
  };

  it("suppresses declined issues and heavily declined categories", () => {
    const model = buildPreferenceModel(preferences);
    expect(
      shouldSuppressSuggestion({ title: 'Spelling: "teh"', issueType: "spelling" }, model),
    ).toBe(true);
    expect(
      shouldSuppressSuggestion({ title: 'Spelling: "the"', issueType: "spelling" }, model),
    ).toBe(true);
    expect(
      shouldSuppressSuggestion({ title: "Extra spaces", issueType: "spacing" }, model),
    ).toBe(false);
  });

  it("boosts accepted patterns ahead of neutral cards when trimming", () => {
    const out = applyFeedbackPreferences(
      [
        { title: "Comma splice nearby", issueType: "punctuation", confidence: 0.9 },
        { title: 'Grammar: "your welcome"', issueType: "grammar", confidence: 0.85 },
      ],
      preferences,
    );
    expect(normalizeIssueKey(out[0].title)).toBe(normalizeIssueKey('Grammar: "your welcome"'));
  });

  it("drops declined cards from merged output", () => {
    const out = applyFeedbackPreferences(
      [
        { title: 'Spelling: "teh"', issueType: "spelling" },
        { title: "Extra spaces", issueType: "spacing" },
      ],
      preferences,
    );
    expect(out.some((s) => normalizeIssueKey(s.title) === normalizeIssueKey('Spelling: "teh"'))).toBe(
      false,
    );
    expect(out.length).toBe(1);
  });
});
