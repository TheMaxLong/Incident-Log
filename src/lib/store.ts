import type { Session, Incident } from "../types";

const SESSIONS_KEY = "inc_sessions_v1";
const INCIDENTS_KEY = "inc_incidents_v1";

function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

export function getSessions(): Session[] {
  return read<Session[]>(SESSIONS_KEY, []);
}

export function saveSession(s: Session): void {
  const all = getSessions().filter(x => x.id !== s.id);
  all.unshift(s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
}

export function updateSession(id: string, patch: Partial<Session>): void {
  const all = getSessions().map(s => s.id === id ? { ...s, ...patch } : s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
}

export function deleteSession(id: string): void {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(getSessions().filter(s => s.id !== id)));
  localStorage.setItem(INCIDENTS_KEY, JSON.stringify(getIncidents().filter(i => i.sessionId !== id)));
}

export function getIncidents(sessionId?: string): Incident[] {
  const all = read<Incident[]>(INCIDENTS_KEY, []);
  return sessionId ? all.filter(i => i.sessionId === sessionId) : all;
}

export function saveIncident(incident: Incident): void {
  const all = getIncidents().filter(i => i.id !== incident.id);
  all.push(incident);
  localStorage.setItem(INCIDENTS_KEY, JSON.stringify(all));
}

export function removeIncident(id: string): void {
  localStorage.setItem(INCIDENTS_KEY, JSON.stringify(getIncidents().filter(i => i.id !== id)));
}
