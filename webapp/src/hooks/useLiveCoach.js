import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { useDebouncedEffect } from "./useDebouncedEffect";

export const SAVE_MS = 450;
export const COACH_PAUSE_MS = 2200;
export const COACH_POLL_MS = 3500;
export const MIN_COACH_CHARS = 32;

/**
 * Chris-prototype-style live coaching: debounced full pass + lighter typing polls.
 * Requires a signed-in Firebase session (Bearer token on POST /coach).
 */
export function useLiveCoach({ enabled, currentId, title, content, onSave }) {
  const coachGenRef = useRef(0);
  const coachInFlightRef = useRef(false);
  const currentIdRef = useRef(null);
  const contentRef = useRef("");
  const lastPausedCoachTextRef = useRef("");
  const lastTypingCoachTextRef = useRef("");
  const coachFailedForTextRef = useRef(null);
  const lastCoachedTextRef = useRef("");
  // Baseline of what's already persisted on the server, so that simply
  // loading/switching documents does not trigger a no-op save that would
  // bump updatedAt and re-sort the document list.
  const lastSavedRef = useRef({ id: null, title: "", content: "" });

  const [saveState, setSaveState] = useState("idle");
  const [coachPhase, setCoachPhase] = useState("inactive");
  const [suggestions, setSuggestions] = useState([]);
  const [retrievedChunks, setRetrievedChunks] = useState([]);
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const [lastCoachAt, setLastCoachAt] = useState(null);
  const [coachError, setCoachError] = useState(null);

  currentIdRef.current = currentId;
  contentRef.current = content;

  const runCoach = useCallback(async (mode) => {
    const m = mode === "typing" ? "typing" : "paused";
    const id = currentIdRef.current;
    const trimmed = String(contentRef.current || "").trim();
    if (!enabled || !id || trimmed.length < MIN_COACH_CHARS) return;
    if (coachInFlightRef.current) return;
    if (coachFailedForTextRef.current !== null && trimmed === coachFailedForTextRef.current) return;
    if (
      m === "paused" &&
      trimmed === lastPausedCoachTextRef.current &&
      coachFailedForTextRef.current === null
    ) {
      return;
    }
    if (
      m === "typing" &&
      trimmed === lastTypingCoachTextRef.current &&
      coachFailedForTextRef.current === null
    ) {
      return;
    }
    // Full (paused) pass already ran for this draft—do not replace with lighter typing-only tips.
    if (
      m === "typing" &&
      trimmed === lastPausedCoachTextRef.current &&
      coachFailedForTextRef.current === null
    ) {
      return;
    }

    coachInFlightRef.current = true;
    const gen = ++coachGenRef.current;
    setCoachPhase("fetching");
    setCoachError(null);
    try {
      const data = await api.coach(trimmed, { coachMode: m });
      if (gen !== coachGenRef.current) return;
      coachFailedForTextRef.current = null;
      lastCoachedTextRef.current = trimmed;
      if (m === "paused") {
        lastPausedCoachTextRef.current = trimmed;
        lastTypingCoachTextRef.current = trimmed;
      } else {
        lastTypingCoachTextRef.current = trimmed;
      }
      const raw = Array.isArray(data.suggestions) ? data.suggestions : [];
      const nextChunks = Array.isArray(data.retrievedChunks) ? data.retrievedChunks : [];
      setSuggestions((prev) => {
        // Paused pass is authoritative for this draft — always replace so we do not
        // keep old cards that isCardStale would hide (blank panel with stale length).
        if (m === "paused") return raw;
        if (trimmed === lastPausedCoachTextRef.current && prev.length > raw.length) return prev;
        return raw.length > 0 ? raw : prev;
      });
      setRetrievedChunks((prev) =>
        m === "paused" || nextChunks.length > 0 ? nextChunks : prev,
      );
      setProfileSnapshot(data.profileSnapshot ?? null);
      setLastCoachAt(new Date().toISOString());
      setCoachPhase("ready");
    } catch (err) {
      if (gen !== coachGenRef.current) return;
      coachFailedForTextRef.current = trimmed;
      const hint =
        err instanceof ApiError && (err.code === "coaching_upstream" || err.code === "coaching_timeout")
          ? " Is coaching-api running (npm run dev:coach)?"
          : err instanceof ApiError && err.code === "server_misconfigured"
            ? " Check COACHING_INTERNAL_SECRET matches on app-api and coaching-api."
            : "";
      setCoachError(
        `Could not refresh suggestions.${hint} Your previous tips stay below.`,
      );
      setCoachPhase("error");
    } finally {
      coachInFlightRef.current = false;
    }
  }, [enabled]);

  const resetCoachState = useCallback(
    (initialBody) => {
      coachFailedForTextRef.current = null;
      coachGenRef.current += 1;
      setCoachError(null);
      setSuggestions([]);
      setRetrievedChunks([]);
      setProfileSnapshot(null);
      setLastCoachAt(null);
      lastPausedCoachTextRef.current = "";
      lastTypingCoachTextRef.current = "";
      lastCoachedTextRef.current = "";
      const body = String(initialBody ?? contentRef.current ?? "").trim();
      setCoachPhase(
        !enabled || !currentIdRef.current
          ? "inactive"
          : body.length < MIN_COACH_CHARS
            ? "needs_more_text"
            : "waiting_pause",
      );
    },
    [enabled],
  );

  const markSaved = useCallback((id, t, c) => {
    lastSavedRef.current = {
      id: id ?? null,
      title: String(t ?? ""),
      content: String(c ?? ""),
    };
  }, []);

  useDebouncedEffect([enabled, currentId, title, content], SAVE_MS, async () => {
    const id = currentId;
    const t = title;
    const c = content;
    if (!enabled || !id) return;
    const last = lastSavedRef.current;
    if (last.id === id && last.title === t && last.content === c) {
      return;
    }
    setSaveState("saving");
    try {
      await api.documents.update(id, { title: t, content: c });
      // Guard against a race where the user switched documents while the
      // PUT was in flight: only update the baseline if we still hold the
      // same document, otherwise we'd clobber the baseline that openDocument
      // just set for the newly opened doc.
      if (currentIdRef.current === id) {
        lastSavedRef.current = { id, title: t, content: c };
      }
      setSaveState("saved");
      await onSave?.();
    } catch {
      setSaveState("error");
    }
  });

  useEffect(() => {
    if (!enabled || !currentId) {
      setCoachPhase("inactive");
      return;
    }
    const trimmed = content.trim();

    // When the user deletes a large chunk of text, clear stale suggestions immediately
    // rather than waiting for the next coach pass.
    if (
      lastCoachedTextRef.current.length > 0 &&
      trimmed.length < lastCoachedTextRef.current.length * 0.55
    ) {
      setSuggestions([]);
      lastCoachedTextRef.current = "";
      lastPausedCoachTextRef.current = "";
      lastTypingCoachTextRef.current = "";
    }

    if (trimmed.length < MIN_COACH_CHARS) {
      setCoachPhase((p) => (p === "fetching" ? p : "needs_more_text"));
      return;
    }
    if (coachFailedForTextRef.current !== null && trimmed === coachFailedForTextRef.current) {
      setCoachPhase((p) => (p === "fetching" ? p : "error"));
      return;
    }
    if (coachFailedForTextRef.current !== null && trimmed !== coachFailedForTextRef.current) {
      coachFailedForTextRef.current = null;
      setCoachError(null);
    }
    if (trimmed === lastPausedCoachTextRef.current) {
      setCoachPhase((p) => (p === "fetching" ? p : "ready"));
      return;
    }
    setCoachPhase((p) => (p === "fetching" ? p : "waiting_pause"));
  }, [enabled, currentId, content]);

  useDebouncedEffect([enabled, currentId, content], COACH_PAUSE_MS, () => {
    void runCoach("paused");
  });

  useEffect(() => {
    if (!enabled || !currentId) return undefined;
    const id = setInterval(() => {
      void runCoach("typing");
    }, COACH_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, currentId, runCoach]);

  return {
    saveState,
    coachPhase,
    suggestions,
    retrievedChunks,
    profileSnapshot,
    lastCoachAt,
    coachError,
    resetCoachState,
    markSaved,
    bumpCoachGeneration: () => {
      coachGenRef.current += 1;
    },
  };
}
