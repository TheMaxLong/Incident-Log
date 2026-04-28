import { useState, useRef, useEffect, useCallback } from "react";
import type { Session, Incident } from "../types";
import { getIncidents, saveIncident, removeIncident, updateSession } from "../lib/store";
import { savePhoto, getPhotos, deletePhotos } from "../lib/db";
import { generateReport } from "../lib/report";

const M = "'JetBrains Mono', 'Courier New', monospace";

type Building = "AB" | "EF" | "GH";

const ROOMS: Record<Building, string[]> = {
  AB: ["AB1","AB2","AB3","AB4","AB5","AB6","AB7","AB8","AB-V"],
  EF: ["EF1","EF2","EF3","EF4","EF5","EF6","EF7","EF8","EF-V1","EF-V2","EF-MOM","EF-CLN"],
  GH: ["GH1","GH2","GH3","GH4","GH5","GH6","GH7","GH8","GH-V1","GH-V2","GH-MOM","GH-CLN"],
};

const CATEGORY_PRESETS = [
  "Equipment Failure",
  "HVAC",
  "Pest / IPM",
  "Power",
  "Irrigation",
  "Environmental",
  "Other",
] as const;

function nowDate() {
  const d = new Date();
  return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

interface PendingPhoto { id: string; name: string; dataUrl: string; }

const inputStyle: React.CSSProperties = {
  background: "#0a0a0a", border: "1px solid #1e293b", borderRadius: "4px",
  padding: "8px 10px", color: "#e2e8f0", fontFamily: M, fontSize: "12px",
  outline: "none", width: "100%", boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: "pointer",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2364748b'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: "28px",
  appearance: "none" as const,
};

const labelStyle: React.CSSProperties = {
  color: "#64748b", fontSize: "10px", letterSpacing: "0.06em", marginBottom: "5px", display: "block",
};

function IncidentCard({
  incident, photos, onDelete,
}: {
  incident: Incident;
  photos: string[];
  onDelete: () => void;
}) {
  return (
    <div style={{ background: "#0f1117", border: "1px solid #1e293b", borderRadius: "6px", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "8px", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ color: "#7dd3fc", fontSize: "12px", fontWeight: "700" }}>
            {incident.building ? `${incident.building}${incident.room ? " · " + incident.room : ""}` : "General Facility"}
          </span>
          <span style={{ background: "#1e293b", borderRadius: "3px", padding: "2px 8px", fontSize: "9px", color: "#94a3b8", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
            {incident.category}
          </span>
          {photos.length > 0 && (
            <span style={{ fontSize: "10px", color: "#475569" }}>📷 {photos.length}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexShrink: 0 }}>
          <span style={{ color: "#475569", fontSize: "10px", whiteSpace: "nowrap" }}>{incident.date} {incident.time}</span>
          <button
            onClick={onDelete}
            style={{ background: "none", border: "none", color: "#334155", fontSize: "14px", cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
          >✕</button>
        </div>
      </div>
      <div style={{ color: "#94a3b8", fontSize: "12px", lineHeight: "1.65", whiteSpace: "pre-wrap" }}>
        {incident.description}
      </div>
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
          {photos.map((src, i) => (
            <img
              key={i} src={src} alt=""
              style={{ width: "80px", height: "60px", objectFit: "cover", borderRadius: "3px", border: "1px solid #1e293b" }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  session: Session;
  onBack: () => void;
}

export default function IncidentPage({ session, onBack }: Props) {
  // Form
  const [date, setDate] = useState(nowDate);
  const [time, setTime] = useState(nowTime);
  const [building, setBuilding] = useState<Building | "">("");
  const [room, setRoom] = useState("");
  const [category, setCategory] = useState("");
  const [otherText, setOtherText] = useState("");
  const [desc, setDesc] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);

  // Page
  const [incidents, setIncidents] = useState<Incident[]>(() =>
    getIncidents(session.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  );
  const [photoCache, setPhotoCache] = useState<Record<string, string>>({});
  const [logging, setLogging] = useState(false);
  const [compiling, setCompiling] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ids = incidents.flatMap(i => i.photoIds);
    if (!ids.length) return;
    getPhotos(ids).then(p => setPhotoCache(p));
  }, [incidents]);

  const compress = useCallback((file: File): Promise<PendingPhoto> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const max = 1400;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL("image/jpeg", 0.82);
        const id = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        resolve({ id, name: file.name, dataUrl });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Load failed")); };
      img.src = url;
    }), []);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const slots = 5 - pendingPhotos.length;
    if (slots <= 0) return;
    const list = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, slots);
    const processed = await Promise.all(list.map(compress));
    setPendingPhotos(prev => [...prev, ...processed]);
  };

  const resolvedCategory = category === "Other" ? otherText.trim() || "Other" : category;
  const canLog = !!(building || true) && !!category && (category !== "Other" || otherText.trim()) && desc.trim();

  const log = async () => {
    if (!canLog || logging) return;
    setLogging(true);

    await Promise.all(pendingPhotos.map(p => savePhoto(p.id, p.dataUrl)));

    const incident: Incident = {
      id: `inc_${Date.now()}`,
      sessionId: session.id,
      date, time,
      building,
      room,
      category: resolvedCategory,
      description: desc.trim(),
      photoIds: pendingPhotos.map(p => p.id),
      createdAt: new Date().toISOString(),
    };

    saveIncident(incident);

    const updated = getIncidents(session.id);
    updateSession(session.id, { incidentCount: updated.length });

    const newCache = { ...photoCache };
    pendingPhotos.forEach(p => { newCache[p.id] = p.dataUrl; });
    setPhotoCache(newCache);

    setIncidents(updated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));

    // Reset form — keep building/room/category for next entry
    setTime(nowTime());
    setDesc("");
    setPendingPhotos([]);
    setLogging(false);
  };

  const deleteInc = async (id: string) => {
    const inc = incidents.find(i => i.id === id);
    if (!inc) return;
    if (inc.photoIds.length) await deletePhotos(inc.photoIds);
    removeIncident(id);
    const updated = getIncidents(session.id);
    updateSession(session.id, { incidentCount: updated.length });
    setIncidents(updated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  };

  const compile = async () => {
    if (!incidents.length) return;
    setCompiling(true);
    const ids = incidents.flatMap(i => i.photoIds);
    const photos = ids.length ? await getPhotos(ids) : {};
    generateReport(incidents, session.name, photos);
    setCompiling(false);
  };

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", fontFamily: M, color: "#e2e8f0", padding: "28px 20px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        input:focus, select:focus, textarea:focus { border-color: #7dd3fc !important; outline: none; }
        textarea { resize: vertical; }
        select { -webkit-appearance: none; appearance: none; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #1e293b; }
      `}</style>

      <div style={{ maxWidth: "600px", margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid #1e293b", paddingBottom: "14px", marginBottom: "24px", flexWrap: "wrap" }}>
          <button
            onClick={onBack}
            style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontFamily: M, fontSize: "12px", padding: 0, letterSpacing: "0.04em" }}
          >← SESSIONS</button>
          <span style={{ color: "#1e293b" }}>|</span>
          <span style={{ fontFamily: "'Space Mono', monospace", color: "#7dd3fc", fontSize: "13px", fontWeight: "bold", letterSpacing: "0.05em", flex: 1 }}>{session.name}</span>
          {session.shift && (
            <span style={{ background: "#0f1117", border: "1px solid #1e293b", borderRadius: "4px", padding: "3px 9px", fontSize: "10px", color: "#64748b" }}>{session.shift}</span>
          )}
        </div>

        {/* NEW INCIDENT FORM */}
        <div style={{ background: "#0f1117", border: "1px solid #1e293b", borderRadius: "8px", padding: "20px", marginBottom: "32px" }}>
          <div style={{ color: "#334155", fontSize: "10px", letterSpacing: "0.1em", marginBottom: "18px" }}>NEW INCIDENT</div>

          {/* Date + Time */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>DATE</label>
              <input value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>TIME OF INCIDENT</label>
              <input value={time} onChange={e => setTime(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Building */}
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>BUILDING</label>
            <div style={{ display: "flex", gap: "6px" }}>
              {(["AB", "EF", "GH"] as Building[]).map(b => (
                <button
                  key={b}
                  onClick={() => { setBuilding(b === building ? "" : b); setRoom(""); }}
                  style={{ background: building === b ? "#7dd3fc" : "transparent", color: building === b ? "#0a0a0a" : "#7dd3fc", border: `1px solid ${building === b ? "#7dd3fc" : "#1e293b"}`, borderRadius: "4px", padding: "7px 18px", fontFamily: M, fontSize: "11px", fontWeight: "bold", cursor: "pointer" }}
                >{b}</button>
              ))}
              <button
                onClick={() => { setBuilding(""); setRoom(""); }}
                style={{ background: building === "" ? "#1e293b" : "transparent", color: "#64748b", border: "1px solid #1e293b", borderRadius: "4px", padding: "7px 12px", fontFamily: M, fontSize: "10px", cursor: "pointer" }}
              >GENERAL</button>
            </div>
          </div>

          {/* Room */}
          {building && (
            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>ROOM</label>
              <select value={room} onChange={e => setRoom(e.target.value)} style={selectStyle}>
                <option value="">— select room</option>
                {ROOMS[building].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}

          {/* Category */}
          <div style={{ marginBottom: category === "Other" ? "8px" : "14px" }}>
            <label style={labelStyle}>CATEGORY</label>
            <select value={category} onChange={e => { setCategory(e.target.value); if (e.target.value !== "Other") setOtherText(""); }} style={selectStyle}>
              <option value="">— select category</option>
              {CATEGORY_PRESETS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Other free-text */}
          {category === "Other" && (
            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>SPECIFY</label>
              <input
                autoFocus
                value={otherText}
                onChange={e => setOtherText(e.target.value)}
                placeholder="Describe the category..."
                style={inputStyle}
              />
            </div>
          )}

          {/* Description */}
          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>DESCRIPTION / NOTES</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What happened? Include any relevant details..."
              rows={4}
              style={{ ...inputStyle }}
            />
          </div>

          {/* Photos */}
          <div style={{ marginBottom: "18px" }}>
            <label style={labelStyle}>PHOTOS ({pendingPhotos.length} / 5 · max 50 MB each)</label>
            {pendingPhotos.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                {pendingPhotos.map(p => (
                  <div key={p.id} style={{ position: "relative" }}>
                    <img
                      src={p.dataUrl} alt={p.name}
                      style={{ width: "80px", height: "60px", objectFit: "cover", borderRadius: "4px", border: "1px solid #1e293b", display: "block" }}
                    />
                    <button
                      onClick={() => setPendingPhotos(prev => prev.filter(x => x.id !== p.id))}
                      style={{ position: "absolute", top: "-7px", right: "-7px", background: "#0a0a0a", border: "1px solid #334155", borderRadius: "50%", width: "18px", height: "18px", color: "#94a3b8", fontSize: "10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            {pendingPhotos.length < 5 && (
              <button
                onClick={() => fileRef.current?.click()}
                style={{ background: "transparent", border: "1px dashed #334155", borderRadius: "4px", padding: "8px 14px", color: "#475569", fontFamily: M, fontSize: "11px", cursor: "pointer" }}
              >+ ADD PHOTO</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
          </div>

          {/* Log button */}
          <button
            onClick={log}
            disabled={!canLog || logging}
            style={{ background: canLog && !logging ? "#7dd3fc" : "#1e293b", color: canLog && !logging ? "#0a0a0a" : "#475569", border: "none", borderRadius: "6px", padding: "10px 24px", fontFamily: M, fontSize: "12px", fontWeight: "bold", cursor: canLog && !logging ? "pointer" : "not-allowed", letterSpacing: "0.06em" }}
          >
            {logging ? "LOGGING…" : "LOG INCIDENT"}
          </button>
        </div>

        {/* Shift log */}
        {incidents.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <span style={{ color: "#334155", fontSize: "10px", letterSpacing: "0.08em" }}>
                SHIFT LOG — {incidents.length} incident{incidents.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={compile}
                disabled={compiling}
                style={{ background: "transparent", color: compiling ? "#475569" : "#7dd3fc", border: `1px solid ${compiling ? "#1e293b" : "#7dd3fc33"}`, borderRadius: "4px", padding: "7px 16px", fontFamily: M, fontSize: "11px", cursor: compiling ? "not-allowed" : "pointer", letterSpacing: "0.04em" }}
              >
                {compiling ? "COMPILING…" : "COMPILE SHIFT REPORT →"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {incidents.map(inc => (
                <IncidentCard
                  key={inc.id}
                  incident={inc}
                  photos={inc.photoIds.map(id => photoCache[id]).filter(Boolean) as string[]}
                  onDelete={() => deleteInc(inc.id)}
                />
              ))}
            </div>
          </>
        )}

        {incidents.length === 0 && (
          <div style={{ textAlign: "center", color: "#334155", fontSize: "11px", padding: "32px 0" }}>
            No incidents logged yet — fill out the form above
          </div>
        )}
      </div>
    </div>
  );
}
