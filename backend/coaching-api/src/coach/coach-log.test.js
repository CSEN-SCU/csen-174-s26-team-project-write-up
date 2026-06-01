import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isCoachLogEnabled,
  isCoachDebugMechanicsEnabled,
  coachDebug,
  coachLogSummary,
} from "./coach-log.js";

describe("coach-log", () => {
  /** @type {Record<string, string | undefined>} */
  const saved = {};

  beforeEach(() => {
    for (const k of ["COACH_LOG", "COACH_DEBUG_MECHANICS"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ["COACH_LOG", "COACH_DEBUG_MECHANICS"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("debug and summary flags default off", () => {
    expect(isCoachLogEnabled()).toBe(false);
    expect(isCoachDebugMechanicsEnabled()).toBe(false);
  });

  it("respects COACH_LOG=1", () => {
    process.env.COACH_LOG = "1";
    expect(isCoachLogEnabled()).toBe(true);
  });

  it("respects COACH_DEBUG_MECHANICS=1", () => {
    process.env.COACH_DEBUG_MECHANICS = "1";
    expect(isCoachDebugMechanicsEnabled()).toBe(true);
  });

  it("coachDebug does not throw when disabled", () => {
    expect(() => coachDebug("test", { a: 1 })).not.toThrow();
  });

  it("coachLogSummary does not throw when disabled", () => {
    expect(() => coachLogSummary({ mechanicsCount: 3 })).not.toThrow();
  });
});
