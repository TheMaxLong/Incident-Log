import type { Archive } from "../types";
import { getSessions, getIncidents, saveSession, saveIncident } from "./store";
import { getAllPhotos, importPhotos } from "./db";

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

export function uploadArchive(file: File): Promise<{ sessions: number; incidents: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const archive = JSON.parse(reader.result as string) as Archive;
        if (archive.version !== 1) throw new Error("Unsupported archive version");

        const existingSessions = new Set(getSessions().map(s => s.id));
        const newSessions = (archive.sessions ?? []).filter(s => !existingSessions.has(s.id));
        newSessions.forEach(saveSession);

        const existingIncidents = new Set(getIncidents().map(i => i.id));
        const newIncidents = (archive.incidents ?? []).filter(i => !existingIncidents.has(i.id));
        newIncidents.forEach(saveIncident);

        if (archive.photos && Object.keys(archive.photos).length) {
          await importPhotos(archive.photos);
        }

        resolve({ sessions: newSessions.length, incidents: newIncidents.length });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
