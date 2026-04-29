import type { Incident } from "../types";

export function generateReport(
  incidents: Incident[],
  sessionName: string,
  photos: Record<string, string>
): void {
  const sorted = [...incidents].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const incidentBlocks = sorted
    .map((inc, idx) => {
      const room = inc.building
        ? `${inc.building}${inc.room ? " · " + inc.room : ""}`
        : "General Facility";

      const photoHtml = inc.photoIds
        .map(pid => {
          const src = photos[pid];
          return src
            ? `<div class="photo-wrap"><img src="${src}" class="photo" alt="Incident photo" /></div>`
            : "";
        })
        .join("");

      return `
        <div class="incident">
          <div class="inc-number">#${String(idx + 1).padStart(2, "0")}</div>
          <div class="inc-header">
            <div class="inc-left">
              <span class="inc-room">${room}</span>
              <span class="inc-cat">${inc.category}</span>
            </div>
            <div class="inc-time">${inc.date} &nbsp; ${inc.time}</div>
          </div>
          <div class="inc-desc">${inc.description.replace(/\n/g, "<br>")}</div>
          ${photoHtml ? `<div class="photos">${photoHtml}</div>` : ""}
        </div>
      `;
    })
    .join("");

  const generatedAt = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Incident Report — ${sessionName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #ffffff;
    color: #1a1a1a;
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 11px;
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
    font-size: 9px;
    letter-spacing: 0.18em;
    color: #888;
    text-transform: uppercase;
    margin-bottom: 14px;
  }

  .cover-title {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.1;
    margin-bottom: 8px;
    color: #fff;
  }

  .cover-session {
    font-size: 13px;
    color: #aaa;
    margin-bottom: 6px;
  }

  .cover-meta {
    font-size: 10px;
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

  /* Incidents */
  .incident {
    padding: 28px 0;
    border-bottom: 1px solid #ebebeb;
  }

  .incident:last-child {
    border-bottom: none;
  }

  .inc-number {
    font-size: 9px;
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
    font-size: 15px;
    font-weight: 700;
    color: #111;
  }

  .inc-cat {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #777;
    background: #f4f4f2;
    padding: 3px 9px;
    border-radius: 2px;
    white-space: nowrap;
  }

  .inc-time {
    font-size: 10px;
    color: #aaa;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .inc-desc {
    font-size: 12px;
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
    max-width: 200px;
    max-height: 150px;
    width: auto;
    height: auto;
    object-fit: cover;
    border-radius: 3px;
    border: 1px solid #e5e5e5;
    display: block;
  }

  @media print {
    .page { width: 100%; max-width: 100%; }
    .cover { padding: 40px 48px 32px; }
    .incidents-wrap { padding: 32px 48px 60px; }
    body { font-size: 10.5px; }
    .incident { page-break-inside: avoid; }
    @page { margin: 0; size: letter; }
  }
</style>
</head>
<body>
<div class="page">

  <div class="cover">
    <div class="cover-eyebrow">Cultivation Facility — Incident Report</div>
    <div class="cover-title">Shift Log</div>
    <div class="cover-session">${sessionName}</div>
    <div class="cover-meta">
      <span>${sorted.length} incident${sorted.length !== 1 ? "s" : ""} · chronological order</span>
      <span>Generated ${generatedAt}</span>
    </div>
  </div>

  <div class="incidents-wrap">
    ${incidentBlocks}
  </div>

</div>
<script>window.onload = () => { window.print(); };<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
