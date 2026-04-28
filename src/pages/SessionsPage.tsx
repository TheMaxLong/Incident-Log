import { useState, useRef } from "react";
import type { Session } from "../types";
import { getSessions, saveSession, deleteSession } from "../lib/store";
import { downloadArchive, uploadArchive } from "../lib/archive";

const M = "'JetBrains Mono', 'Courier New', monospace";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatSessionDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

const inp: React.CSSProperties = {
  width: "100%", background: "#0a0a0a", border: "1px solid #1e293b",
  borderRadius: "4px", padding: "9px 10px", color: "#e2e8f0",
  fontFamily: M, fontSize: "12px", outline: "none", boxSizing: "border-box",
};

const btn = (active: boolean): React.CSSProperties => ({
  background: active ? "#7dd3fc" : "transparent",
  color: active ? "#0a0a0a" : "#7dd3fc",
  border: `1px solid ${active ? "#7dd3fc" : "#1e293b"}`,
  borderRadius: "4px", padding: "6px 14px", fontFamily: M,
  fontSize: "11px", fontWeight: "bold", cursor: "pointer",
});

interface Props { onSelect: (s: Session) => void; }

export default function SessionsPage({ onSelect }: Props) {
  const [sessions, setSessions] = useState<Session[]>(getSessions);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftShift, setDraftShift] = useState<"S1" | "S2" | "">("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const create = () => {
    const d = todayISO();
    const name = draftName.trim() || `${d}${draftShift ? " · " + draftShift : ""}`;
    const session: Session = {
      id: Date.now().toString(),
      name, date: d, shift: draftShift,
      createdAt: new Date().toISOString(),
      incidentCount: 0,
    };
    saveSession(session);
    setSessions(getSessions());
    setCreating(false);
    setDraftName("");
    setDraftShift("");
    onSelect(session);
  };

  const remove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this session and all its incidents?")) return;
    deleteSession(id);
    setSessions(getSessions());
  };

  const handleImport = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    setImportMsg("");
    try {
      const { sessions: s, incidents: i } = await uploadArchive(file);
      setSessions(getSessions());
      setImportMsg(`Imported ${s} session${s !== 1 ? "s" : ""}, ${i} incident${i !== 1 ? "s" : ""}`);
    } catch {
      setImportMsg("Import failed — invalid file");
    }
    setImporting(false);
  };

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", fontFamily: M, color: "#e2e8f0", padding: "28px 20px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        input:focus { border-color: #7dd3fc !important; }
      `}</style>

      <div style={{ maxWidth: "560px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: "1px solid #1e293b", paddingBottom: "14px", marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <span style={{ fontFamily: "'Space Mono', monospace", color: "#7dd3fc", fontSize: "15px", fontWeight: "bold", letterSpacing: "0.06em" }}>INCIDENT LOG</span>
            <span style={{ color: "#334155", fontSize: "11px" }}>v0428</span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => downloadArchive()}
              title="Download archive"
              style={{ background: "transparent", border: "1px solid #1e293b", borderRadius: "4px", padding: "5px 10px", color: "#475569", fontFamily: M, fontSize: "11px", cursor: "pointer" }}
            >↓ EXPORT</button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              title="Upload archive"
              style={{ background: "transparent", border: "1px solid #1e293b", borderRadius: "4px", padding: "5px 10px", color: "#475569", fontFamily: M, fontSize: "11px", cursor: "pointer" }}
            >{importing ? "…" : "↑ IMPORT"}</button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={e => handleImport(e.target.files?.[0] ?? null)} />
          </div>
        </div>

        {importMsg && (
          <div style={{ color: importMsg.includes("failed") ? "#f87171" : "#4ade80", fontSize: "11px", marginBottom: "14px", padding: "8px 12px", background: "#0f1117", borderRadius: "4px", border: "1px solid #1e293b" }}>
            {importMsg}
          </div>
        )}

        {/* New session */}
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            style={{ width: "100%", background: "transparent", border: "1px dashed #334155", borderRadius: "6px", padding: "14px", color: "#7dd3fc", fontFamily: M, fontSize: "12px", cursor: "pointer", letterSpacing: "0.05em", marginBottom: "28px" }}
          >+ NEW SESSION</button>
        ) : (
          <div style={{ background: "#0f1117", border: "1px solid #1e293b", borderRadius: "6px", padding: "18px", marginBottom: "28px" }}>
            <div style={{ color: "#334155", fontSize: "10px", letterSpacing: "0.08em", marginBottom: "14px" }}>NEW SESSION</div>
            <input
              autoFocus
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && create()}
              placeholder={`${todayISO()} — optional label`}
              style={{ ...inp, marginBottom: "10px" }}
            />
            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "14px" }}>
              {(["S1", "S2"] as const).map(s => (
                <button key={s} onClick={() => setDraftShift(draftShift === s ? "" : s)} style={btn(draftShift === s)}>{s}</button>
              ))}
              <span style={{ color: "#334155", fontSize: "10px", marginLeft: "4px" }}>shift (optional)</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={create} style={{ background: "#7dd3fc", color: "#0a0a0a", border: "none", borderRadius: "4px", padding: "9px 20px", fontFamily: M, fontSize: "11px", fontWeight: "bold", cursor: "pointer", letterSpacing: "0.06em" }}>CREATE</button>
              <button onClick={() => { setCreating(false); setDraftName(""); setDraftShift(""); }} style={{ background: "transparent", color: "#475569", border: "1px solid #1e293b", borderRadius: "4px", padding: "9px 14px", fontFamily: M, fontSize: "11px", cursor: "pointer" }}>CANCEL</button>
            </div>
          </div>
        )}

        {/* Session list */}
        {sessions.length === 0 ? (
          <div style={{ textAlign: "center", color: "#334155", fontSize: "12px", padding: "48px 0" }}>No sessions yet — create one above</div>
        ) : (
          <>
            <div style={{ color: "#334155", fontSize: "10px", letterSpacing: "0.08em", marginBottom: "10px" }}>SESSIONS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {sessions.map(s => (
                <div
                  key={s.id}
                  onClick={() => onSelect(s)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "#0f1117", border: "1px solid #1e293b", borderRadius: "6px", cursor: "pointer", transition: "border-color 0.12s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "#7dd3fc44")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "#1e293b")}
                >
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "#e2e8f0", marginBottom: "4px" }}>{s.name}</div>
                    <div style={{ fontSize: "10px", color: "#475569" }}>
                      {formatSessionDate(s.date)}
                      {s.shift ? ` · ${s.shift}` : ""}
                      {" · "}
                      <span style={{ color: s.incidentCount > 0 ? "#94a3b8" : "#334155" }}>
                        {s.incidentCount} incident{s.incidentCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ color: "#334155", fontSize: "16px" }}>→</span>
                    <button
                      onClick={e => remove(s.id, e)}
                      style={{ background: "none", border: "none", color: "#334155", fontSize: "14px", cursor: "pointer", padding: "2px 6px", lineHeight: 1 }}
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
