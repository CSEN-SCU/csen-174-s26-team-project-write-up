/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sidepanelHtml = readFileSync(resolve(here, "sidepanel.html"), "utf8");

const EXPECTED_WEBAPP_URL = "http://127.0.0.1:5050/";

describe("Side panel home button", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = sidepanelHtml;
  });

  test("clicking the home button takes the user to the Web App", () => {
    // As a writer using the Write Up Chrome side panel, when I click the home icon
    // I land on the Write Up webapp landing page in a new tab.

    // Arrange
    const homeLink = document.getElementById("home-link");

    // Act / Assert: the link is wired to the webapp URL.
    expect(homeLink).not.toBeNull();
    expect(homeLink.tagName).toBe("A");
    expect(homeLink.getAttribute("href")).toBe(EXPECTED_WEBAPP_URL);
  });

  test("home button opens the Web App in a new tab safely", () => {
    // The link must open in a new tab and use rel="noopener noreferrer" so the
    // newly opened webapp tab cannot script back into the extension side panel.

    // Arrange
    const homeLink = document.getElementById("home-link");

    // Assert
    expect(homeLink.getAttribute("target")).toBe("_blank");
    const rel = homeLink.getAttribute("rel") || "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });
});
