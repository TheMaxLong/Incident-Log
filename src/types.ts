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
  urgent?: boolean;
}

export interface Archive {
  version: 1;
  exportedAt: string;
  sessions: Session[];
  incidents: Incident[];
  photos: Record<string, string>;
}

export interface FluxuumZone {
  zone: string;
  recipe: string | null;
  readingCount: number;
  flaggedCount: number;
  status: "clean" | "warning" | "critical";
  ph1Avg: number | null; ph1Min: number | null; ph1Max: number | null;
  ph2Avg: number | null; ph2Min: number | null; ph2Max: number | null;
  ecAvg: number | null;  ecMin: number | null;  ecMax: number | null;
  flowAvg: number | null; flowMax: number | null;
}

export interface FluxuumAnomaly {
  id: unknown;
  time: string;
  zone: string;
  recipe: string;
  ph1: number | null; ph2: number | null;
  ec: number | null;  flowRate: number | null;
  accumulatedGal: number | null;
  reasons: string[];
}

export interface FluxuumReport {
  period: { from: string; to: string; hours: number };
  overview: {
    totalReadings: number; flaggedCount: number; flaggedPct: number;
    zonesActive: number; zonesWithFlags: number;
    ph1Avg: number | null; ph2Avg: number | null;
    ecAvg: number | null;  flowAvg: number | null;
  };
  zoneBreakdown: FluxuumZone[];
  anomalies: FluxuumAnomaly[];
  aiNarrative: string | null;
  generatedAt: string;
}
