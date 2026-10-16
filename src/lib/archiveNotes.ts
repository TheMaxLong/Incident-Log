import type { Incident, Session } from "../types";
import { getSessions, getIncidents } from "./store";

/**
 * Harvest Archive notes (2026-10-16).
 *
 * COMPILE REPORT also sends this session's entries to the Harvest Archive, where they
 * show as night-shift notes on each room's harvest dossier. The archive matches every
 * entry on its id, so pressing compile twice — or again after adding a last-minute
 * entry — never doubles anything: unchanged entries are already in, edited ones are
 * updated, new ones are added. Photos are not sent.
 *
 * The archive is on the private (tailnet) link. When it can't be reached — Tailscale
 * off on the phone, usually — the night is remembered here and sent on its own the
 * next time the app opens or comes back to the front (see retryUnsent).
 */

/** The Harvest Archive page; its notes door sits in the same folder. Fixed on purpose:
 *  no other setting in the app can move where the notes go. */
export const HARVEST_ARCHIVE_URL = "https://anderson-hub.tailf0f27a.ts.net/observatory/harvest-archive-v2.html";
const SUBMIT_URL = new URL("incident-notes/submit", HARVEST_ARCHIVE_URL).href;
const UNSENT_KEY = "harvest_archive_unsent_v1";

export interface ArchiveSendResult {
  ok: boolean;
  added: number;
  updated: number;
  already_in: number;
  duplicates_skipped: number;
  total: number;
}

/** The archive was never reached (no answer at all) — on the phone that is almost always Tailscale off.
 *  `blocked` = Chrome's local-network permission is denied for this app, so nothing could leave the phone. */
export class ArchiveNotReached extends Error {
  constructor(message: string, public blocked = false) { super(message); }
}

/** Chrome asks once before a website may reach devices on your own network (the hub, over Tailscale).
 *  "denied" here means every send — and the FLUXUUM link — is blocked until it is allowed in site settings. */
async function localNetworkDenied(): Promise<boolean> {
  try {
    const p = await navigator.permissions.query({ name: "local-network" as PermissionName });
    return p.state === "denied";
  } catch {
    return false;
  }
}

export async function sendToHarvestArchive(session: Session, incidents: Incident[]): Promise<ArchiveSendResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), sessions: [session], incidents }),
      signal: ctrl.signal,
    });
  } catch {
    if (await localNetworkDenied()) {
      throw new ArchiveNotReached("Chrome is blocking this app from your local network", true);
    }
    throw new ArchiveNotReached("Harvest Archive not reached");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `Harvest Archive answered ${res.status}`);
  return data as ArchiveSendResult;
}

export function describeSend(r: ArchiveSendResult): string {
  const parts: string[] = [];
  if (r.added) parts.push(`${r.added} new`);
  if (r.updated) parts.push(`${r.updated} updated`);
  if (r.already_in) parts.push(`${r.already_in} already in`);
  if (r.duplicates_skipped) parts.push(`${r.duplicates_skipped} duplicate${r.duplicates_skipped !== 1 ? "s" : ""} skipped`);
  const head = r.added || r.updated ? "✓ HARVEST ARCHIVE NOTES UPDATED" : "✓ HARVEST ARCHIVE — NOTHING NEW, NOTHING DOUBLED";
  return `${head} · ${parts.join(" · ")}`;
}

// ── nights waiting to be sent ────────────────────────────────────────────────

export function getUnsent(): string[] {
  try { return JSON.parse(localStorage.getItem(UNSENT_KEY) ?? "[]") ?? []; }
  catch { return []; }
}

export function markUnsent(sessionId: string): void {
  const all = getUnsent().filter(id => id !== sessionId);
  all.push(sessionId);
  localStorage.setItem(UNSENT_KEY, JSON.stringify(all));
}

export function clearUnsent(sessionId: string): void {
  localStorage.setItem(UNSENT_KEY, JSON.stringify(getUnsent().filter(id => id !== sessionId)));
}

let retrying = false;

/** Send every night still waiting, with its entries as they are now (late additions go too).
 *  Stops at the first "not reached" — the archive is out of reach for all of them. */
export async function retryUnsent(): Promise<{ sent: string[]; waiting: number; error?: string }> {
  if (retrying) return { sent: [], waiting: getUnsent().length };
  retrying = true;
  const sent: string[] = [];
  let error: string | undefined;
  try {
    const sessions = getSessions();
    for (const id of getUnsent()) {
      const session = sessions.find(s => s.id === id);
      const incidents = getIncidents(id);
      if (!session || !incidents.length) { clearUnsent(id); continue; }  // deleted here: nothing to send
      try {
        await sendToHarvestArchive(session, incidents);
        clearUnsent(id);
        sent.push(session.name);
      } catch (err) {
        error = err instanceof Error ? err.message : "send failed";
        if (err instanceof ArchiveNotReached) break;
      }
    }
  } finally {
    retrying = false;
  }
  return { sent, waiting: getUnsent().length, error };
}
