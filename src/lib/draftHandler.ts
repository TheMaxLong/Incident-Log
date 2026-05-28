import type { Session } from "../types";
import { getSessions, saveSession } from "./store";

export interface DraftPayload {
  description: string;
  recordedAt: string | null;  // ISO timestamp
  durationSec: number | null;
  testMode: boolean;
}

/** Decode base64 (URL-safe) text. Handles Unicode. */
function decodeBase64(b64: string): string {
  // Convert URL-safe variants
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  // Walk bytes back to Unicode
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Parse URL params on page load. Returns null if no draft present or parse fails. */
export function readDraftFromUrl(search: string = window.location.search): DraftPayload | null {
  const params = new URLSearchParams(search);
  const draft = params.get("draft");
  if (!draft) return null;
  try {
    const description = decodeBase64(draft);
    return {
      description,
      recordedAt: params.get("recorded"),
      durationSec: params.get("dur") ? Number(params.get("dur")) : null,
      testMode: params.get("test") === "1",
    };
  } catch (e) {
    console.error("[draftHandler] base64 decode failed:", e);
    return null;
  }
}

/** Return today's YYYY-MM-DD in local time. */
function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Find or create the session for today. Defaults to night shift (S2). */
export function findOrCreateTodaySession(): Session {
  const today = todayISO();
  const sessions = getSessions();
  const existing = sessions.find(s => s.date === today);
  if (existing) return existing;

  const created: Session = {
    id: Date.now().toString(),
    name: `${today} · S2`,
    date: today,
    shift: "S2",
    createdAt: new Date().toISOString(),
    incidentCount: 0,
  };
  saveSession(created);
  return created;
}

/** Convert an ISO timestamp into HH:MM (24h) for the time field. */
export function isoToHHMM(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Strip the draft params from the URL after consumption so reload doesn't re-trigger. */
export function clearDraftParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("draft");
  url.searchParams.delete("recorded");
  url.searchParams.delete("dur");
  url.searchParams.delete("test");
  window.history.replaceState({}, "", url.toString());
}
