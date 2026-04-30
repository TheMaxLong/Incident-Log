import type { Incident } from "../types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toSafeDataImage(url: string | undefined): string {
  if (!url) return "";
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(url) ? url : "";
}

export function generateReport(
  incidents: Incident[],
  sessionName: string,
  photos: Record<string, string>
): void {
  const sorted = [...incidents].sort((a, b) => {
    if (a.urgent && !b.urgent) return -1;
    if (!a.urgent && b.urgent) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const incidentBlocks = sorted
    .map((inc, idx) => {
      const room = inc.building
        ? `${inc.building}${inc.room ? " · " + inc.room : ""}`
        : "General Facility";

      const safeRoom = escapeHtml(room);
      const safeCategory = escapeHtml(inc.category);
      const safeDate = escapeHtml(inc.date);
      const safeTime = escapeHtml(inc.time);
      const safeDescription = escapeHtml(inc.description).replace(/\n/g, "<br>");

      const photoHtml = inc.photoIds
        .map(pid => {
          const src = toSafeDataImage(photos[pid]);
          return src
            ? `<div class="photo-wrap"><img src="${src}" class="photo" alt="Incident photo" /></div>`
            : "";
        })
        .join("");

      return `
        <div class="incident${inc.urgent ? " urgent" : ""}">
          <div class="inc-number${inc.urgent ? " urgent-num" : ""}">${inc.urgent ? "⚑ " : ""}#${String(idx + 1).padStart(2, "0")}${inc.urgent ? " URGENT **" : ""}</div>
          <div class="inc-header">
            <div class="inc-left">
              <span class="inc-room">${safeRoom}</span>
              <span class="inc-cat">${safeCategory}</span>
            </div>
            <div class="inc-time">${safeDate} &nbsp; ${safeTime}</div>
          </div>
          <div class="inc-desc">${safeDescription}</div>
          ${photoHtml ? `<div class="photos">${photoHtml}</div>` : ""}
        </div>
      `;
    });

  const firstIncidentBlock = incidentBlocks[0] ?? "";
  const remainingIncidentBlocks = incidentBlocks.slice(1).join("");

  const generatedAt = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const isLongReport = sorted.length >= 15;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Incident Report — ${escapeHtml(sessionName)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #ffffff;
    color: #1a1a1a;
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 17px;
    line-height: 1.6;
  }

  .page {
    width: 100%;
    max-width: 100%;
    padding: 0;
  }

  /* Cover */
  .cover {
    background: #1a1a1a;
    color: #f5f5f5;
    padding: 48px 64px 40px;
    margin-bottom: 0;
  }

  .cover-eyebrow {
    font-size: 14px;
    letter-spacing: 0.18em;
    color: #888;
    text-transform: uppercase;
    margin-bottom: 14px;
  }

  .cover-title {
    font-size: 35px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.1;
    margin-bottom: 8px;
    color: #fff;
  }

  .cover-session {
    font-size: 19px;
    color: #aaa;
    margin-bottom: 6px;
  }

  .cover-meta {
    font-size: 15px;
    color: #666;
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid #333;
    display: flex;
    gap: 28px;
  }

  .incidents-wrap {
    padding: 40px 64px 80px;
  }

  .first-incident-wrap {
    padding-top: 20px;
  }

  /* Incidents */
  .incident {
    padding: 28px 0;
    border-bottom: 1px solid #ebebeb;
  }

  .incident:last-child {
    border-bottom: none;
  }

  .inc-number {
    font-size: 14px;
    font-weight: 700;
    color: #ccc;
    letter-spacing: 0.1em;
    margin-bottom: 6px;
  }

  .inc-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 10px;
    gap: 16px;
  }

  .inc-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .inc-room {
    font-size: 21px;
    font-weight: 700;
    color: #111;
  }

  .inc-cat {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #777;
    background: #f4f4f2;
    padding: 4px 10px;
    border-radius: 2px;
    white-space: nowrap;
  }

  .inc-time {
    font-size: 15px;
    color: #aaa;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .inc-desc {
    font-size: 18px;
    color: #333;
    line-height: 1.75;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    max-width: 580px;
  }

  .photos {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
  }

  .photo-wrap { flex: 0 0 auto; }

  .photo {
    max-width: 368px;
    max-height: 276px;
    width: auto;
    height: auto;
    object-fit: cover;
    border-radius: 3px;
    border: 1px solid #e5e5e5;
    display: block;
  }

  .incident.urgent {
    border-left: 4px solid #dc2626;
    padding-left: 16px;
    margin-left: -16px;
  }

  .inc-number.urgent-num {
    color: #dc2626;
    font-size: 13px;
  }

  @media print {
    .page { width: 100%; max-width: 100%; }
    .cover { padding: 30px 40px 24px; }
    .incidents-wrap { padding: 24px 40px 48px; }
    .first-page-block { page-break-inside: avoid; break-inside: avoid-page; }
    .first-incident-wrap { padding-top: 12px; }
    body { font-size: 17pt; }
    .inc-room { font-size: 21pt !important; }
    .inc-cat { font-size: 13pt !important; }
    .inc-time { font-size: 14pt !important; }
    .inc-desc { font-size: 17pt !important; }
    .inc-number { font-size: 13pt !important; }
    .incident { page-break-inside: avoid; break-inside: avoid-page; }
    .long-report .incidents-wrap:not(.first-incident-wrap) { padding: 18px 34px 40px; }
    .long-report .incidents-wrap:not(.first-incident-wrap) .incident { padding: 20px 0; }
    .long-report .incidents-wrap:not(.first-incident-wrap) .inc-desc {
      font-size: 15pt !important;
      line-height: 1.62;
    }
    .long-report .incidents-wrap:not(.first-incident-wrap) .photo {
      max-width: 320px;
      max-height: 240px;
    }
    @page { margin: 12mm; }
  }
</style>
</head>
<body class="${isLongReport ? "long-report" : ""}">
<div class="page">

  <div class="first-page-block">
    <div class="cover">
      <div class="cover-eyebrow">Cultivation Facility — Incident Report</div>
      <div class="cover-title">Shift Log</div>
      <div class="cover-session">${escapeHtml(sessionName)}</div>
      <div class="cover-meta">
        <span>${sorted.length} incident${sorted.length !== 1 ? "s" : ""} · chronological order</span>
        <span>Generated ${generatedAt}</span>
      </div>
    </div>

    ${firstIncidentBlock ? `<div class="incidents-wrap first-incident-wrap">${firstIncidentBlock}</div>` : ""}
  </div>

  ${remainingIncidentBlocks ? `<div class="incidents-wrap">${remainingIncidentBlocks}</div>` : ""}

</div>
<script>window.onload = () => { window.print(); };<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
