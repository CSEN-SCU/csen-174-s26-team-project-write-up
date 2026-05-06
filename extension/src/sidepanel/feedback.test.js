import { describe, expect, it } from "vitest";

describe("Feedback (side panel)", () => {
  it.skip(
    "shows a loading state while coaching-api processes my draft [deferred to week 2 sprint: feedback-state.js / side panel loading path not implemented yet]",
    async () => {
      // As a writer using the Write Up Chrome side panel, when I click "Get feedback" I immediately see a loading message so I know my request is in flight.

      // Arrange
      const expected = {
        statusLabel: "Calling coaching-api…",
        outputText: "",
        outputMeta: "",
        isError: false,
        submitDisabled: true,
      };

      // Action — once feedback-state.js exists, this import resolves and returns the real loading view-state.
      const { feedbackLoadingState } = await import("./feedback-state.js");
      const ui = feedbackLoadingState();

      // Assert
      expect(ui.statusLabel).toBe(expected.statusLabel);
      expect(ui.outputText).toBe(expected.outputText);
      expect(ui.outputMeta).toBe(expected.outputMeta);
      expect(ui.isError).toBe(expected.isError);
      expect(ui.submitDisabled).toBe(expected.submitDisabled);
    },
  );
});
