import { describe, expect, test } from "vitest";
import { isLikelyGibberishToken } from "./word-quality.js";
import {
  draftHasHeavyUnknownTokens,
  spellDictionarySuggestions,
} from "../coach/heuristics.js";

describe("word-quality", () => {
  test("flags keyboard-mash tokens", () => {
    expect(isLikelyGibberishToken("adpghawdo")).toBe(true);
    expect(isLikelyGibberishToken("hello")).toBe(false);
    expect(isLikelyGibberishToken("cannot")).toBe(false);
  });

  test("detects mostly-unknown-token drafts", () => {
    const mash = `adpghawdo[gh aeiighawe-9gjja[wej[aodj hello omg`;
    expect(draftHasHeavyUnknownTokens(mash)).toBe(true);
  });

  test("spell dictionary skips noisy tokens but can flag real words in mixed drafts", () => {
    const text = `adpghawdo[gh aeiighawe-9gjja[wej[aodj hello omg i need help`;
    const cards = spellDictionarySuggestions(text);
    const titles = cards.map((c) => c.title).join(" ");
    expect(titles).not.toMatch(/aodj/i);

    const withTypo = `hello i cant write good definately`;
    const typoCards = spellDictionarySuggestions(withTypo);
    expect(typoCards.some((c) => /definately/i.test(c.title))).toBe(true);
  });
});
