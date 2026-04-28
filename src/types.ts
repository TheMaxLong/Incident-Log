export interface Session {
  id: string;
  name: string;
  date: string;       // YYYY-MM-DD
  shift: "S1" | "S2" | "";
  createdAt: string;
  incidentCount: number;
}

export interface Incident {
  id: string;
  sessionId: string;
  date: string;         // MM/DD/YYYY display
  time: string;         // HH:MM
  building: string;     // "AB" | "EF" | "GH" | "" (general)
  room: string;
  category: string;     // preset or free-text when "Other"
  description: string;
  photoIds: string[];
  createdAt: string;    // ISO — used for chronological sort
}

export interface Archive {
  version: 1;
  exportedAt: string;
  sessions: Session[];
  incidents: Incident[];
  photos: Record<string, string>;
}
