import type { Archive, Incident, Session } from "../types";
import { getSessions, getIncidents, saveSession, saveIncident, updateSession } from "./store";
import { getAllPhotos, importPhotos } from "./db";

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function sessionMergeKey(session: Pick<Session, "name" | "date" | "shift">): string {
  return [session.date, session.shift ?? "", normalizeText(session.name)].join("|");
}

function incidentMergeKey(incident: Pick<Incident, "sessionId" | "date" | "time" | "building" | "room" | "category" | "description" | "urgent">): string {
  return [
    incident.sessionId,
    normalizeText(incident.date),
    normalizeText(incident.time),
    normalizeText(incident.building),
    normalizeText(incident.room),
    normalizeText(incident.category),
    normalizeText(incident.description),
    incident.urgent ? "1" : "0",
  ].join("|");
}

function syncSessionIncidentCounts(): void {
  const sessions = getSessions();
  const incidents = getIncidents();
  const counts = new Map<string, number>();

  incidents.forEach(incident => {
    counts.set(incident.sessionId, (counts.get(incident.sessionId) ?? 0) + 1);
  });

  sessions.forEach(session => {
    const nextCount = counts.get(session.id) ?? 0;
    if (session.incidentCount !== nextCount) {
      updateSession(session.id, { incidentCount: nextCount });
    }
  });
}

export async function downloadArchive(): Promise<void> {
  const sessions = getSessions();
  const incidents = getIncidents();
  const photos = await getAllPhotos();

  const archive: Archive = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions,
    incidents,
    photos,
  };

  const blob = new Blob([JSON.stringify(archive)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `incident-log-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function uploadArchive(file: File): Promise<{
  sessions: number;
  incidents: number;
  skippedSessions: number;
  skippedIncidents: number;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const archive = JSON.parse(reader.result as string) as Archive;
        if (archive.version !== 1) throw new Error("Unsupported archive version");

        const incomingSessions = Array.isArray(archive.sessions) ? archive.sessions : [];
        const incomingIncidents = Array.isArray(archive.incidents) ? archive.incidents : [];
        const incomingPhotos = archive.photos && typeof archive.photos === "object" ? archive.photos : {};

        const currentSessions = getSessions();
        const sessionById = new Map(currentSessions.map(s => [s.id, s]));
        const sessionKeyToId = new Map(currentSessions.map(s => [sessionMergeKey(s), s.id]));
        const sessionIdMap = new Map<string, string>();

        let addedSessions = 0;
        let skippedSessions = 0;

        for (const session of incomingSessions) {
          if (!session?.id) {
            skippedSessions += 1;
            continue;
          }

          if (sessionById.has(session.id)) {
            sessionIdMap.set(session.id, session.id);
            skippedSessions += 1;
            continue;
          }

          const key = sessionMergeKey(session);
          const existingIdByKey = sessionKeyToId.get(key);
          if (existingIdByKey) {
            sessionIdMap.set(session.id, existingIdByKey);
            skippedSessions += 1;
            continue;
          }

          saveSession(session);
          sessionById.set(session.id, session);
          sessionKeyToId.set(key, session.id);
          sessionIdMap.set(session.id, session.id);
          addedSessions += 1;
        }

        const knownSessionIds = new Set(getSessions().map(s => s.id));
        const existingIncidents = getIncidents();
        const existingIncidentIds = new Set(existingIncidents.map(i => i.id));
        const existingIncidentKeys = new Set(existingIncidents.map(i => incidentMergeKey(i)));

        const importedIncidentPhotoIds = new Set<string>();
        let addedIncidents = 0;
        let skippedIncidents = 0;

        for (const incident of incomingIncidents) {
          if (!incident?.id) {
            skippedIncidents += 1;
            continue;
          }

          const mappedSessionId = sessionIdMap.get(incident.sessionId) ?? incident.sessionId;
          if (!knownSessionIds.has(mappedSessionId)) {
            skippedIncidents += 1;
            continue;
          }

          const normalizedIncident: Incident = {
            ...incident,
            sessionId: mappedSessionId,
          };

          if (existingIncidentIds.has(normalizedIncident.id)) {
            skippedIncidents += 1;
            continue;
          }

          const key = incidentMergeKey(normalizedIncident);
          if (existingIncidentKeys.has(key)) {
            skippedIncidents += 1;
            continue;
          }

          saveIncident(normalizedIncident);
          normalizedIncident.photoIds.forEach(id => importedIncidentPhotoIds.add(id));
          existingIncidentIds.add(normalizedIncident.id);
          existingIncidentKeys.add(key);
          addedIncidents += 1;
        }

        if (Object.keys(incomingPhotos).length) {
          const photosToImport: Record<string, string> = {};
          importedIncidentPhotoIds.forEach(id => {
            const value = incomingPhotos[id];
            if (typeof value === "string") photosToImport[id] = value;
          });
          if (Object.keys(photosToImport).length) {
            await importPhotos(photosToImport);
          }
        }

        syncSessionIncidentCounts();

        resolve({
          sessions: addedSessions,
          incidents: addedIncidents,
          skippedSessions,
          skippedIncidents,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
