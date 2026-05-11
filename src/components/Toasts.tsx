/**
 * Discreet bottom-right toast stack.
 *
 * Surfaces background problems (photo decode failures, storage warnings)
 * without blocking the main UI. Each toast auto-dismisses after AUTO_MS;
 * tap to dismiss early. Stack grows upward.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_MS = 6500;

export type ToastSeverity = "info" | "warn" | "error";

export interface Toast {
  id: string;
  severity: ToastSeverity;
  message: string;
  detail?: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const push = useCallback(
    (severity: ToastSeverity, message: string, detail?: string) => {
      const id = `t_${Date.now()}_${counterRef.current++}`;
      setToasts((prev) => [...prev, { id, severity, message, detail }]);
    },
    [],
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss };
}

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 8,
        zIndex: 1000,
        pointerEvents: "none",
        maxWidth: "min(360px, calc(100vw - 24px))",
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, AUTO_MS);
    return () => window.clearTimeout(id);
  }, [onDismiss]);

  const palette = severityPalette(toast.severity);

  return (
    <div
      onClick={onDismiss}
      role="status"
      style={{
        pointerEvents: "auto",
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        borderLeft: `4px solid ${palette.accent}`,
        borderRadius: 6,
        padding: "8px 12px",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontSize: 12,
        lineHeight: 1.4,
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        cursor: "pointer",
        animation: "toast-slide-in 180ms ease-out",
        wordBreak: "break-word",
      }}
    >
      <style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <div style={{ fontWeight: 600, marginBottom: toast.detail ? 2 : 0 }}>
        {toast.message}
      </div>
      {toast.detail && (
        <div style={{ color: palette.detail, fontSize: 11, fontWeight: 400 }}>
          {toast.detail}
        </div>
      )}
    </div>
  );
}

function severityPalette(s: ToastSeverity) {
  switch (s) {
    case "error":
      return {
        bg: "#fef2f2",
        text: "#7f1d1d",
        detail: "#9b2c2c",
        border: "#fecaca",
        accent: "#dc2626",
      };
    case "warn":
      return {
        bg: "#fffbeb",
        text: "#78350f",
        detail: "#92400e",
        border: "#fde68a",
        accent: "#f59e0b",
      };
    default:
      return {
        bg: "#f8fafc",
        text: "#0f172a",
        detail: "#475569",
        border: "#e2e8f0",
        accent: "#64748b",
      };
  }
}
