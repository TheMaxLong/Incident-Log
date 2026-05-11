import { useState, useRef, useEffect, useCallback } from "react";
import type { Session, Incident, FluxuumReport } from "../types";
import { getIncidents, saveIncident, removeIncident, updateSession } from "../lib/store";
import { savePhoto, getPhotos, deletePhotos } from "../lib/db";
import { generateReport, type CompileMode } from "../lib/report";
import {
  ensurePersistentStorage,
  getStorageEstimate,
  formatBytes,
  type PersistenceStatus,
  type StorageEstimate,
} from "../lib/storage";
import { ToastStack, useToasts } from "../components/Toasts";

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

function isValidDateText(value: string): boolean {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return false;
  const [m, d, y] = value.split("/").map(Number);
  if (!m || !d || !y) return false;
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}

function isValidTimeText(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

interface PendingPhoto { id: string; name: string; dataUrl: string; isExisting?: boolean; }

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
  incident, photos, onDelete, onEdit,
}: {
  incident: Incident;
  photos: string[];
  onDelete: () => void;
  onEdit: () => void;
}) {
  return (
    <div style={{
      background: "#0f1117",
      border: incident.urgent ? "1px solid #7f1d1d" : "1px solid #1e293b",
      borderLeft: incident.urgent ? "3px solid #dc2626" : "1px solid #1e293b",
      borderRadius: "6px",
      padding: "14px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "8px", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ color: "#7dd3fc", fontSize: "12px", fontWeight: "700" }}>
            {incident.building ? `${incident.building}${incident.room ? " · " + incident.room : ""}` : "General Facility"}
          </span>
          <span style={{ background: "#1e293b", borderRadius: "3px", padding: "2px 8px", fontSize: "9px", color: "#94a3b8", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
            {incident.category}
          </span>
          {incident.urgent && (
            <span style={{ background: "#1a0000", border: "1px solid #7f1d1d", borderRadius: "3px", padding: "2px 7px", fontSize: "9px", color: "#dc2626", letterSpacing: "0.08em", whiteSpace: "nowrap", fontWeight: "700" }}>
              URGENT **
            </span>
          )}
          {photos.length > 0 && (
            <span style={{ fontSize: "10px", color: "#475569" }}>📷 {photos.length}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexShrink: 0 }}>
          <span style={{ color: "#475569", fontSize: "10px", whiteSpace: "nowrap" }}>{incident.date} {incident.time}</span>
          <button
            onClick={onEdit}
            title="Edit incident"
            style={{ background: "none", border: "none", color: "#475569", fontSize: "13px", cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
          >✎</button>
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
  const [date, setDate] = useState(nowDate);
  const [time, setTime] = useState(nowTime);
  const [building, setBuilding] = useState<Building | "">("");
  const [room, setRoom] = useState("");
  const [category, setCategory] = useState("");
  const [otherText, setOtherText] = useState("");
  const [desc, setDesc] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [urgent, setUrgent] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);

  const sortIncidents = (list: Incident[]) =>
    [...list].sort((a, b) => {
      if (a.urgent && !b.urgent) return -1;
      if (!a.urgent && b.urgent) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const [incidents, setIncidents] = useState<Incident[]>(() =>
    sortIncidents(getIncidents(session.id))
  );
  const [photoCache, setPhotoCache] = useState<Record<string, string>>({});
  const [logging, setLogging] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [actionError, setActionError] = useState("");

  // ── Storage health (persistence + usage) ─────────────────────────────────
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null);
  const [storageEst, setStorageEst] = useState<StorageEstimate | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await ensurePersistentStorage();
      if (cancelled) return;
      setPersistence(status);
      // Only notify if the request was just made and DENIED — that's the only
      // actionable case. Silent grant is the happy path; silent skip
      // (already-persisted from prior session) doesn't need a toast either.
      if (status.supported && status.requested && !status.persisted) {
        pushToast(
          "warn",
          "Photos may not survive the OS",
          "Browser didn't grant persistent storage. Open the app a few more times — Chrome usually grants it after repeated use.",
        );
      }
      const est = await getStorageEstimate();
      if (cancelled) return;
      setStorageEst(est);
      if (est && est.usagePct > 85) {
        pushToast(
          "warn",
          "Photo storage almost full",
          `Using ${formatBytes(est.usageBytes)} of ${formatBytes(est.quotaBytes)} (${est.usagePct.toFixed(0)}%). Archive or delete old sessions to free space.`,
        );
      }
    })();
    return () => { cancelled = true; };
  }, [pushToast]);

  // ── FLUXUUM integration ──────────────────────────────────────────────────
  const [fluxuumUrl, setFluxuumUrl]       = useState(() => localStorage.getItem("fluxuumApiUrl") ?? "");
  const [fluxuumHours, setFluxuumHours]   = useState<6|12|24|48>(() => {
    const saved = localStorage.getItem("fluxuumHours");
    return (saved && [6,12,24,48].includes(Number(saved)) ? Number(saved) : 48) as 6|12|24|48;
  });
  const [fluxuumData, setFluxuumData]     = useState<FluxuumReport | null>(null);
  const [fluxuumLoading, setFluxuumLoading] = useState(false);
  const [fluxuumError, setFluxuumError]   = useState<string | null>(null);
  const [showFluxuumPanel, setShowFluxuumPanel] = useState(false);
  const [compileMode, setCompileMode]     = useState<CompileMode>("incidents");

  const fetchFluxuum = async () => {
    let base = fluxuumUrl.trim();
    if (!base) { setFluxuumError("Enter the FLUXUUM URL first."); return; }
    // Accept full URLs — strip any path, just keep origin
    try { base = new URL(base).origin; } catch { base = base.replace(/\/$/, ""); }
    setFluxuumLoading(true);
    setFluxuumError(null);
    try {
      localStorage.setItem("fluxuumApiUrl", base);
      localStorage.setItem("fluxuumHours", String(fluxuumHours));
      const res = await fetch(`${base}/api/analytics/incident-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: fluxuumHours, skipAi: false }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data: FluxuumReport = await res.json();
      setFluxuumData(data);
      if (compileMode === "incidents") setCompileMode("merged");
    } catch (err) {
      setFluxuumError(err instanceof Error ? err.message : "Fetch failed — check URL and try again.");
    } finally {
      setFluxuumLoading(false);
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ids = incidents.flatMap(i => i.photoIds);
    if (!ids.length) return;
    getPhotos(ids)
      .then(p => {
        setPhotoCache(p);
        // Detect the "came back after hours, my photos got evicted" case:
        // we had photo IDs saved on incidents but IndexedDB returned fewer
        // (or empty) blobs. This is the OS-storage-eviction signal.
        const expected = ids.length;
        const got = Object.keys(p).length;
        if (expected > 0 && got < expected) {
          pushToast(
            "error",
            `${expected - got} of ${expected} saved photo${expected === 1 ? "" : "s"} missing`,
            "Browser storage was cleared while the app was inactive. Re-add them from your photo gallery to restore.",
          );
        }
      })
      .catch((err) =>
        pushToast(
          "error",
          "Could not load saved photos",
          err instanceof Error ? err.message : String(err),
        ),
      );
  }, [incidents, pushToast]);

  const compress = useCallback((file: File): Promise<PendingPhoto> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const max = 1400;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          const ctx = c.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas not available"));
            return;
          }
          ctx.drawImage(img, 0, 0, c.width, c.height);
          const dataUrl = c.toDataURL("image/jpeg", 0.82);
          const id = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          resolve({ id, name: file.name, dataUrl });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Browser couldn't decode ${file.type || "image"}`));
      };
      img.src = url;
    }), []);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const slots = 5 - pendingPhotos.length;
    if (slots <= 0) return;
    const list = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, slots);
    setActionError("");
    const processed = await Promise.allSettled(list.map(compress));
    const ok: PendingPhoto[] = [];
    const failures: Array<{ name: string; type: string; size: number; reason: string }> = [];
    processed.forEach((result, i) => {
      if (result.status === "fulfilled") {
        ok.push(result.value);
      } else {
        const f = list[i];
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        failures.push({
          name: f?.name ?? "(unknown)",
          type: f?.type || "unknown",
          size: f?.size ?? 0,
          reason,
        });
      }
    });
    if (ok.length) setPendingPhotos(prev => [...prev, ...ok]);
    failures.forEach(f =>
      pushToast(
        "error",
        `${f.name} failed to load`,
        `${f.reason} · ${f.type} · ${formatBytes(f.size)}`,
      ),
    );
  };

  const startEdit = (incident: Incident) => {
    setEditingId(incident.id);
    setDate(incident.date);
    setTime(incident.time);
    setBuilding((incident.building as Building) || "");
    setRoom(incident.room || "");

    const isPreset = (CATEGORY_PRESETS as readonly string[]).includes(incident.category);
    if (isPreset) {
      setCategory(incident.category);
      setOtherText("");
    } else {
      setCategory("Other");
      setOtherText(incident.category);
    }

    setDesc(incident.description);
    setUrgent(incident.urgent ?? false);

    // Load existing photos into pending so they display in the form
    const existing: PendingPhoto[] = incident.photoIds.map(id => ({
      id,
      name: id,
      dataUrl: photoCache[id] ?? "",
      isExisting: true,
    }));
    setPendingPhotos(existing);

    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDate(nowDate());
    setTime(nowTime());
    setBuilding("");
    setRoom("");
    setCategory("");
    setOtherText("");
    setDesc("");
    setPendingPhotos([]);
    setUrgent(false);
    setActionError("");
  };

  const resolvedCategory = category === "Other" ? otherText.trim() || "Other" : category;
  const canLog =
    !!category &&
    (category !== "Other" || otherText.trim()) &&
    desc.trim() &&
    isValidDateText(date) &&
    isValidTimeText(time);

  const log = async () => {
    if (!canLog || logging) return;
    setLogging(true);
    setActionError("");

    try {
      const originalInc = editingId ? incidents.find(i => i.id === editingId) : null;

      // Photos that were in the original but removed during edit
      if (originalInc) {
        const keptIds = new Set(pendingPhotos.filter(p => p.isExisting).map(p => p.id));
        const toDelete = originalInc.photoIds.filter(id => !keptIds.has(id));
        if (toDelete.length) await deletePhotos(toDelete);
      }

      // Save only newly added photos (not existing ones)
      const newPhotos = pendingPhotos.filter(p => !p.isExisting);
      await Promise.all(newPhotos.map(p => savePhoto(p.id, p.dataUrl)));

      const incident: Incident = {
        id: editingId ?? `inc_${Date.now()}`,
        sessionId: session.id,
        date,
        time,
        building,
        room,
        category: resolvedCategory,
        description: desc.trim(),
        photoIds: pendingPhotos.map(p => p.id),
        createdAt: originalInc?.createdAt ?? new Date().toISOString(),
        urgent,
      };

      saveIncident(incident);

      const updated = getIncidents(session.id);
      updateSession(session.id, { incidentCount: updated.length });

      const newCache = { ...photoCache };
      newPhotos.forEach(p => {
        newCache[p.id] = p.dataUrl;
      });
      setPhotoCache(newCache);

      setIncidents(sortIncidents(updated));

      if (editingId) {
        cancelEdit();
      } else {
        setTime(nowTime());
        setDesc("");
        setPendingPhotos([]);
        setUrgent(false);
      }
    } catch {
      setActionError("Could not save this incident. Your data is unchanged.");
    } finally {
      setLogging(false);
    }
  };

  const deleteInc = async (id: string) => {
    setActionError("");
    try {
      const inc = incidents.find(i => i.id === id);
      if (!inc) return;
      if (inc.photoIds.length) await deletePhotos(inc.photoIds);
      removeIncident(id);
      if (editingId === id) cancelEdit();
      const updated = getIncidents(session.id);
      updateSession(session.id, { incidentCount: updated.length });
      setIncidents(sortIncidents(updated));
    } catch {
      setActionError("Delete failed. Please try again.");
    }
  };

  const compile = async () => {
    if (!incidents.length) return;
    setCompiling(true);
    setActionError("");
    try {
      const ids = incidents.flatMap(i => i.photoIds);
      const photos = ids.length ? await getPhotos(ids) : {};
      generateReport(incidents, session.name, photos, compileMode, fluxuumData ?? undefined);
    } catch {
      setActionError("Could not generate report. Please try again.");
    } finally {
      setCompiling(false);
    }
  };

  const isEditing = editingId !== null;

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

        {/* FORM */}
        <div
          ref={formRef}
          style={{
            background: "#0f1117",
            border: `1px solid ${isEditing ? "#7dd3fc44" : "#1e293b"}`,
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "32px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
            <div style={{ color: isEditing ? "#7dd3fc" : "#334155", fontSize: "10px", letterSpacing: "0.1em" }}>
              {isEditing ? "EDITING INCIDENT" : "NEW INCIDENT"}
            </div>
            {isEditing && (
              <button
                onClick={cancelEdit}
                style={{ background: "none", border: "none", color: "#475569", fontFamily: M, fontSize: "10px", cursor: "pointer", letterSpacing: "0.06em" }}
              >CANCEL</button>
            )}
          </div>

          {actionError && (
            <div style={{ color: "#f87171", fontSize: "11px", marginBottom: "12px", padding: "8px 10px", borderRadius: "4px", border: "1px solid #7f1d1d", background: "#1a0000" }}>
              {actionError}
            </div>
          )}

          {/* Date + Time */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>DATE</label>
              <input value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
              {!isValidDateText(date) && (
                <div style={{ color: "#f59e0b", fontSize: "10px", marginTop: "4px" }}>Use MM/DD/YYYY format.</div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>TIME OF INCIDENT</label>
              <input value={time} onChange={e => setTime(e.target.value)} style={inputStyle} />
              {!isValidTimeText(time) && (
                <div style={{ color: "#f59e0b", fontSize: "10px", marginTop: "4px" }}>Use 24h HH:MM format.</div>
              )}
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
                      src={p.dataUrl || photoCache[p.id] || ""} alt={p.name}
                      style={{ width: "80px", height: "60px", objectFit: "cover", borderRadius: "4px", border: `1px solid ${p.isExisting ? "#334155" : "#1e293b"}`, display: "block" }}
                    />
                    {p.isExisting && (
                      <div style={{ position: "absolute", bottom: "2px", left: "2px", background: "#0a0a0a99", borderRadius: "2px", padding: "1px 4px", fontSize: "8px", color: "#64748b" }}>saved</div>
                    )}
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

          {/* Submit button */}
          <div style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between" }}>
            <button
              onClick={log}
              disabled={!canLog || logging}
              style={{ background: canLog && !logging ? "#7dd3fc" : "#1e293b", color: canLog && !logging ? "#0a0a0a" : "#475569", border: "none", borderRadius: "6px", padding: "10px 24px", fontFamily: M, fontSize: "12px", fontWeight: "bold", cursor: canLog && !logging ? "pointer" : "not-allowed", letterSpacing: "0.06em" }}
            >
              {logging ? (isEditing ? "SAVING…" : "LOGGING…") : (isEditing ? "SAVE CHANGES" : "LOG INCIDENT")}
            </button>
            <button
              onClick={() => setUrgent(u => !u)}
              style={{
                background: urgent ? "#1a0000" : "transparent",
                color: urgent ? "#dc2626" : "#475569",
                border: urgent ? "1px solid #dc2626" : "1px solid #334155",
                borderRadius: "6px",
                padding: "10px 16px",
                fontFamily: M,
                fontSize: "11px",
                fontWeight: urgent ? "bold" : "normal",
                cursor: "pointer",
                letterSpacing: "0.06em",
              }}
            >
              URGENT **
            </button>
          </div>
        </div>

        {/* Shift log */}
        {incidents.length > 0 && (
          <>
            {/* ── Compile / FLUXUUM bar ── */}
            <div style={{ background: "#0f1117", border: "1px solid #1e293b", borderRadius: "8px", padding: "16px 18px", marginBottom: "16px" }}>

              {/* Row 1: log count + compile button */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ color: "#334155", fontSize: "10px", letterSpacing: "0.08em" }}>
                  SHIFT LOG — {incidents.length} incident{incidents.length !== 1 ? "s" : ""}
                  {fluxuumData && (
                    <span style={{ marginLeft: "10px", color: "#7dd3fc", fontSize: "9px", letterSpacing: "0.06em" }}>
                      + FLUXUUM {fluxuumData.period.hours}h · {fluxuumData.overview.totalReadings} readings
                    </span>
                  )}
                </span>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => setShowFluxuumPanel(p => !p)}
                    style={{
                      background: showFluxuumPanel ? "#0c1a2e" : "transparent",
                      color: fluxuumData ? "#7dd3fc" : "#475569",
                      border: `1px solid ${fluxuumData ? "#7dd3fc44" : "#1e293b"}`,
                      borderRadius: "4px", padding: "6px 12px",
                      fontFamily: M, fontSize: "10px", cursor: "pointer", letterSpacing: "0.04em",
                    }}
                  >
                    {fluxuumData ? "✓ FLUXUUM LINKED" : "+ FLUXUUM"}
                  </button>
                  <button
                    onClick={compile}
                    disabled={compiling}
                    style={{
                      background: compiling ? "transparent" : "#7dd3fc",
                      color: compiling ? "#475569" : "#0a0a0a",
                      border: `1px solid ${compiling ? "#1e293b" : "#7dd3fc"}`,
                      borderRadius: "4px", padding: "7px 16px",
                      fontFamily: M, fontSize: "11px", fontWeight: "bold",
                      cursor: compiling ? "not-allowed" : "pointer", letterSpacing: "0.04em",
                    }}
                  >
                    {compiling ? "COMPILING…" : "COMPILE REPORT →"}
                  </button>
                </div>
              </div>

              {/* Row 2: compile mode selector (only when fluxuumData loaded) */}
              {fluxuumData && (
                <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #1e293b", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <span style={{ color: "#334155", fontSize: "9px", letterSpacing: "0.1em", alignSelf: "center", marginRight: "4px" }}>OUTPUT:</span>
                  {(["incidents","merged","separate"] as CompileMode[]).map(m => {
                    const labels: Record<CompileMode, string> = {
                      incidents: "INCIDENTS ONLY",
                      merged:    "MERGED PDF",
                      separate:  "SEPARATE PDFs",
                    };
                    return (
                      <button
                        key={m}
                        onClick={() => setCompileMode(m)}
                        style={{
                          background: compileMode === m ? "#1e3a5f" : "transparent",
                          color: compileMode === m ? "#7dd3fc" : "#475569",
                          border: `1px solid ${compileMode === m ? "#7dd3fc44" : "#1e293b"}`,
                          borderRadius: "4px", padding: "5px 10px",
                          fontFamily: M, fontSize: "10px", cursor: "pointer", letterSpacing: "0.04em",
                        }}
                      >{labels[m]}</button>
                    );
                  })}
                </div>
              )}

              {/* Row 3: FLUXUUM config panel */}
              {showFluxuumPanel && (
                <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid #1e293b" }}>
                  <div style={{ color: "#64748b", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "10px" }}>FLUXUUM CONNECTION</div>

                  <div style={{ display: "flex", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
                    <input
                      type="url"
                      value={fluxuumUrl}
                      onChange={e => setFluxuumUrl(e.target.value)}
                      placeholder="https://your-fluxuum.replit.app"
                      style={{ ...inputStyle, flex: "1", minWidth: "200px", fontSize: "11px" }}
                    />
                    <div style={{ display: "flex", gap: "4px" }}>
                      {([6,12,24,48] as const).map(h => (
                        <button
                          key={h}
                          onClick={() => setFluxuumHours(h)}
                          style={{
                            background: fluxuumHours === h ? "#1e3a5f" : "transparent",
                            color: fluxuumHours === h ? "#7dd3fc" : "#475569",
                            border: `1px solid ${fluxuumHours === h ? "#7dd3fc44" : "#1e293b"}`,
                            borderRadius: "4px", padding: "7px 10px",
                            fontFamily: M, fontSize: "10px", cursor: "pointer",
                          }}
                        >{h}h</button>
                      ))}
                    </div>
                  </div>

                  {fluxuumError && (
                    <div style={{ color: "#f87171", fontSize: "10px", marginBottom: "8px", padding: "6px 8px", background: "#1a0000", borderRadius: "3px", border: "1px solid #7f1d1d" }}>
                      {fluxuumError}
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button
                      onClick={fetchFluxuum}
                      disabled={fluxuumLoading}
                      style={{
                        background: fluxuumLoading ? "transparent" : "#0c2a4a",
                        color: fluxuumLoading ? "#475569" : "#7dd3fc",
                        border: "1px solid #7dd3fc44",
                        borderRadius: "4px", padding: "7px 14px",
                        fontFamily: M, fontSize: "10px", fontWeight: "bold",
                        cursor: fluxuumLoading ? "not-allowed" : "pointer", letterSpacing: "0.06em",
                      }}
                    >
                      {fluxuumLoading ? "FETCHING…" : "FETCH SENSOR DATA"}
                    </button>
                    {fluxuumData && (
                      <button
                        onClick={() => { setFluxuumData(null); setCompileMode("incidents"); }}
                        style={{ background: "none", border: "none", color: "#475569", fontFamily: M, fontSize: "10px", cursor: "pointer" }}
                      >✕ clear</button>
                    )}
                    {fluxuumData && (
                      <span style={{ color: "#4ade80", fontSize: "10px" }}>
                        ✓ {fluxuumData.overview.totalReadings} readings · {fluxuumData.overview.flaggedCount} flagged
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Incident cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {incidents.map(inc => (
                <IncidentCard
                  key={inc.id}
                  incident={inc}
                  photos={inc.photoIds.map(id => photoCache[id]).filter(Boolean) as string[]}
                  onDelete={() => deleteInc(inc.id)}
                  onEdit={() => startEdit(inc)}
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

        {/* Discreet storage diagnostics — bottom of page, muted */}
        <StorageBadge persistence={persistence} estimate={storageEst} />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function StorageBadge({
  persistence,
  estimate,
}: {
  persistence: PersistenceStatus | null;
  estimate: StorageEstimate | null;
}) {
  if (!persistence) return null;
  const dotColor =
    !persistence.supported
      ? "#9ca3af"
      : persistence.persisted
        ? "#16a34a"
        : "#f59e0b";
  const stateLabel =
    !persistence.supported
      ? "storage status unknown"
      : persistence.persisted
        ? "photos protected from auto-cleanup"
        : "photos not protected (Chrome will likely grant after more visits)";
  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 12,
        borderTop: "1px solid #e2e8f0",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 10,
        color: "#64748b",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
        }}
      />
      <span>{stateLabel}</span>
      {estimate && estimate.quotaBytes > 0 && (
        <span style={{ color: "#94a3b8" }}>
          · {formatBytes(estimate.usageBytes)} / {formatBytes(estimate.quotaBytes)} used
          {estimate.usagePct > 0 ? ` (${estimate.usagePct.toFixed(1)}%)` : ""}
        </span>
      )}
    </div>
  );
}
