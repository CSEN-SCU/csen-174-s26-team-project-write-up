/**
 * Sprint 1 TDD note: if your team must submit tests while they are still RED, temporarily replace
 * `guardrails.js` with stubs (e.g. functions that return the input unchanged) until you implement the rules.
 */
import { describe, expect, test } from "vitest";
import {
  allowOnlyKnownSuggestionTypes,
  applyRagFeedbackGuardrails,
  dropMalformedSuggestions,
  enforceSuggestionLimit,
  extractQuotedPhrases,
  filterQuotedEvidenceInUserText,
} from "./guardrails.js";

describe("RAG / LLM feedback guardrails", () => {
  // As a writer, I do not see completely empty suggestion cards that the model accidentally emitted.
  test("drops suggestions that have no title and no body", () => {
    // Arrange
    const suggestions = [
      { type: "grammar", title: "Spelling", body: "Fix the typo.", micro_edit: null },
      { type: "grammar", title: "", body: "", micro_edit: null },
      { type: "clarity", title: "", body: "Only body is fine.", micro_edit: null },
    ];

    // Act
    const filtered = dropMalformedSuggestions(suggestions);

    // Assert
    expect(filtered).toHaveLength(2);
    expect(filtered.map((s) => s.title)).toEqual(["Spelling", ""]);
  });

  // As a student, I only want feedback that uses our app's real categories so the UI does not show nonsense labels.
  test("removes suggestions whose type is not in the allowed coaching set", () => {
    // Arrange
    const suggestions = [
      { type: "grammar", title: "Agreement", body: "Subject and verb should match.", micro_edit: null },
      { type: "hallucination_category", title: "Oops", body: "Bad type from model.", micro_edit: null },
    ];

    // Act
    const filtered = allowOnlyKnownSuggestionTypes(suggestions);

    // Assert
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("grammar");
  });

  // As a writer, if the coach puts a specific word in quotes, that word should actually appear in my draft — otherwise the model may be making up errors.
  test("removes suggestions whose quoted words do not appear in my draft text", () => {
    // Arrange
    const userText = "I definately want to improve this paragraph.";
    const suggestions = [
      {
        type: "grammar",
        title: 'Spelling: "definately"',
        body: 'Standard spelling is **definitely**.',
        micro_edit: "definitely",
      },
      {
        type: "grammar",
        title: 'Spelling: "xyzabc"',
        body: "This word is not in your draft.",
        micro_edit: null,
      },
    ];

    // Act
    const filtered = filterQuotedEvidenceInUserText(suggestions, userText);

    // Assert
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toContain("definately");
  });

  // As a writer, I still see helpful tips when the title does not quote a specific token (so we do not over-filter generic advice).
  test("keeps suggestions with no quoted evidence even when the draft is unrelated to specific words", () => {
    // Arrange
    const userText = "Short draft.";
    const suggestions = [
      {
        type: "coherence",
        title: "Very long sentence(s)",
        body: "Try splitting the longest sentence for clarity.",
        micro_edit: null,
      },
    ];

    // Act
    const filtered = filterQuotedEvidenceInUserText(suggestions, userText);

    // Assert
    expect(filtered).toHaveLength(1);
  });

  // As a writer, I never get an overwhelming list from one refresh — the coach caps how many cards appear at once.
  test("limits the number of suggestions returned in a single coaching pass", () => {
    // Arrange
    const suggestions = Array.from({ length: 15 }, (_, i) => ({
      type: "clarity",
      title: `Tip ${i + 1}`,
      body: "Note",
      micro_edit: null,
    }));

    // Act
    const capped = enforceSuggestionLimit(suggestions, 10);

    // Assert
    expect(capped).toHaveLength(10);
    expect(capped[0].title).toBe("Tip 1");
    expect(capped[9].title).toBe("Tip 10");
  });

  // As a writer, one pipeline step applies all safety filters in a sensible order before I read the panel.
  test("applyRagFeedbackGuardrails runs type, evidence, malformed, and limit rules together", () => {
    // Arrange
    const userText = 'Only "hello" appears here.';
    const suggestions = [
      { type: "grammar", title: 'OK "hello"', body: "Good.", micro_edit: null },
      { type: "fake", title: 'Bad type "hello"', body: "x", micro_edit: null },
      { type: "clarity", title: "", body: "", micro_edit: null },
      { type: "voice", title: 'Wrong quote "goodbye"', body: "Not in draft.", micro_edit: null },
      ...Array.from({ length: 12 }, (_, i) => ({
        type: "pattern",
        title: `Extra ${i}`,
        body: "b",
        micro_edit: null,
      })),
    ];

    // Act
    const out = applyRagFeedbackGuardrails(suggestions, { userText, max: 5 });

    // Assert
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out.every((s) => s.title !== "" || String(s.body || "").trim() !== "")).toBe(true);
    expect(out.every((s) => ["pattern", "coherence", "clarity", "grammar", "punctuation", "voice"].includes(s.type))).toBe(
      true,
    );
    expect(out.some((s) => String(s.title).includes("goodbye"))).toBe(false);
  });

  test("extractQuotedPhrases finds phrases in straight and curly double quotes", () => {
    // Arrange
    const s = 'Look at "recieve" and \u201coccured\u201d please.';

    // Act
    const phrases = extractQuotedPhrases(s, 3);

    // Assert
    expect(phrases).toContain("recieve");
    expect(phrases).toContain("occured");
  });
});
