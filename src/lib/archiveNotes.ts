import type { Incident, Session } from "../types";

/**
 * Harvest Archive notes (2026-10-16).
 *
 * COMPILE REPORT also sends this session's entries to the hub, where they join the
 * night-shift notes on each room's harvest dossier. The hub matches every entry on
 * its id, so pressing compile twice — or again after adding a last-minute entry —
 * never doubles anything: unchanged entries are already in, edited ones are updated,
 * new ones are added. Photos are not sent.
 *
 * It goes to the same hub address as the FLUXUUM link, on the private (tailnet) link.
 */

export interface ArchiveSendResult {
  ok: boolean;
  added: number;
  updated: number;
  already_in: number;
  duplicates_skipped: number;
  total: number;
}

export async function sendToHarvestArchive(
  hubUrl: string,
  session: Session,
  incidents: Incident[],
): Promise<ArchiveSendResult> {
  let origin = hubUrl.trim();
  try { origin = new URL(origin).origin; } catch { origin = origin.replace(/\/$/, ""); }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${origin}/incident-notes/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions: [session],
        incidents,
      }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `hub responded ${res.status}`);
    return data as ArchiveSendResult;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw new Error("no answer in 20s");
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
