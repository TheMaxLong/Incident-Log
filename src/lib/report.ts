import type { Incident, FluxuumReport, FluxuumZone } from "../types";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export type CompileMode = "incidents" | "merged" | "separate";

function escapeHtml(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function toSafeDataImage(url: string | undefined): string {
  if (!url) return "";
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(url) ? url : "";
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function sc(status: FluxuumZone["status"]) {
  return status === "critical" ? "#dc2626" : status === "warning" ? "#d97706" : "#16a34a";
}
function sb(status: FluxuumZone["status"]) {
  return status === "critical" ? "#fef2f2" : status === "warning" ? "#fffbeb" : "#f0fdf4";
}

// ── Sensor report body (zone table only — anomaly log + AI in FLUXUUM) ───────
function buildSensorBody(data: FluxuumReport): string {
  const { zoneBreakdown } = data;

  const zoneRows = zoneBreakdown.slice(0, 24).map((z: FluxuumZone) => `
    <tr>
      <td class="zt">
        ${escapeHtml(z.zone)}
        ${z.recipe ? `<div style="font-size:10pt;color:#9ca3af;font-weight:400;margin-top:2px;letter-spacing:.02em">${escapeHtml(z.recipe)}</div>` : ""}
      </td>
      <td class="zt r">${z.readingCount}</td>
      <td class="zt r" style="color:${z.flaggedCount>0?"#dc2626":"#16a34a"};font-weight:700">${z.flaggedCount}</td>
      <td class="zt r">${z.ph1Avg??"—"}</td>
      <td class="zt r">${z.ph2Avg??"—"}</td>
      <td class="zt r">${z.ecAvg??"—"}</td>
      <td class="zt r">${z.flowAvg??"—"}</td>
      <td class="zt" style="text-align:center">
        <span style="background:${sb(z.status)};color:${sc(z.status)};border:1px solid ${sc(z.status)};border-radius:3px;padding:2px 6px;font-size:10pt;font-weight:700">${z.status.toUpperCase()}</span>
      </td>
    </tr>`).join("");

  return `
    ${zoneBreakdown.length > 0 ? `
    <div class="section-head">Zone Breakdown</div>
    <table class="zone-table">
      <thead><tr>
        <th>ZONE</th><th class="r">RDGS</th><th class="r">FLAGS</th>
        <th class="r">pH1 AVG</th><th class="r">pH2 AVG</th><th class="r">EC AVG</th>
        <th class="r">FLOW AVG</th><th style="text-align:center">STATUS</th>
      </tr></thead>
      <tbody>${zoneRows}</tbody>
    </table>` : `<div class="clean-banner">✓ No anomalies in this window — all zones clean.</div>`}`;
}

// ── Cover block for the sensor section ───────────────────────────────────────
function buildSensorCover(data: FluxuumReport, newPage = false): string {
  const { period, overview } = data;
  const breakStyle = newPage ? "page-break-before:always;break-before:page;" : "";
  return `
  <div class="sensor-cover" style="${breakStyle}">
    <div class="sc-eyebrow">Sensor Data — FLUXUUM Logger</div>
    <div class="sc-title">Runoff Analysis</div>
    <div class="sc-period">${fmtTime(period.from)} → ${fmtTime(period.to)} &nbsp;·&nbsp; ${period.hours}h window</div>
    <div class="sc-stats">
      <div class="sc-stat"><div class="sc-val">${overview.totalReadings}</div><div class="sc-key">READINGS</div></div>
      <div class="sc-stat"><div class="sc-val" style="color:${overview.flaggedCount>0?"#f87171":"#4ade80"}">${overview.flaggedCount}</div><div class="sc-key">FLAGGED</div></div>
      <div class="sc-stat"><div class="sc-val">${overview.zonesActive}</div><div class="sc-key">ZONES</div></div>
      <div class="sc-stat"><div class="sc-val">${overview.ph1Avg?.toFixed(2)??"—"}</div><div class="sc-key">pH1 AVG</div></div>
      <div class="sc-stat"><div class="sc-val">${overview.ph2Avg?.toFixed(2)??"—"}</div><div class="sc-key">pH2 AVG</div></div>
      <div class="sc-stat"><div class="sc-val">${overview.ecAvg?.toFixed(2)??"—"}</div><div class="sc-key">EC AVG</div></div>
    </div>
  </div>`;
}

// ── Shared CSS ────────────────────────────────────────────────────────────────
const INCIDENT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#fff;color:#1a1a1a;font-family:'JetBrains Mono','Courier New',monospace;font-size:17px;line-height:1.6}
  .page{width:100%;max-width:100%;padding:0}
  .cover{background:#1a1a1a;color:#f5f5f5;padding:48px 64px 40px}
  .cover-eyebrow{font-size:14px;letter-spacing:.18em;color:#888;text-transform:uppercase;margin-bottom:14px}
  .cover-title{font-size:35px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1.1;margin-bottom:8px;color:#fff}
  .cover-session{font-size:19px;color:#aaa;margin-bottom:6px}
  .cover-meta{font-size:15px;color:#666;margin-top:24px;padding-top:20px;border-top:1px solid #333;display:flex;gap:28px;flex-wrap:wrap}
  .incidents-wrap{padding:20px 64px 24px}
  .first-incident-wrap{padding-top:0}
  .first-incident-wrap .photo{max-width:437px;max-height:328px}
  .incident{padding:16px 0;border-bottom:1px solid #ebebeb}
  .incident:last-child{border-bottom:none}
  .inc-number{font-size:14px;font-weight:700;color:#ccc;letter-spacing:.1em;margin-bottom:6px}
  .inc-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;gap:16px}
  .inc-left{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .inc-room{font-size:21px;font-weight:700;color:#111}
  .inc-cat{font-size:14px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#777;background:#f4f4f2;padding:4px 10px;border-radius:2px;white-space:nowrap}
  .inc-time{font-size:15px;color:#aaa;white-space:nowrap;flex-shrink:0}
  .inc-desc{font-size:22px;color:#333;line-height:1.75;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:580px}
  .photos{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
  .photo-wrap{flex:0 0 auto;page-break-inside:avoid;break-inside:avoid}
  .photo{max-width:374px;max-height:281px;width:auto;height:auto;object-fit:cover;border-radius:3px;border:1px solid #e5e5e5;display:block}
  .incident.urgent{border-left:4px solid #dc2626;padding-left:16px;margin-left:-16px}
  .inc-number.urgent-num{color:#dc2626;font-size:13px}
  @media print{
    .cover{padding:22px 36px 18px}
    .cover-eyebrow{font-size:12pt;margin-bottom:8px}
    .cover-title{font-size:28pt;margin-bottom:4px}
    .cover-session{font-size:16pt}
    .cover-meta{font-size:12pt;margin-top:14px;padding-top:12px}
    .incidents-wrap{padding:20px 36px 40px}
    .first-incident-wrap{padding-top:0;margin-top:0}
    .first-page-block{page-break-inside:auto;break-inside:auto}
    body{font-size:20pt;line-height:1.6}
    .inc-room{font-size:24pt!important}
    .inc-cat{font-size:15pt!important}
    .inc-time{font-size:16pt!important}
    .inc-desc{font-size:20pt!important;line-height:1.68;orphans:3;widows:3}
    .inc-number{font-size:15pt!important}
    .incident{page-break-inside:auto;break-inside:auto}
    .inc-number,.inc-header{page-break-after:avoid;break-after:avoid-page}
    .long-report .incidents-wrap:not(.first-incident-wrap){padding:14px 30px 36px}
    .long-report .incidents-wrap:not(.first-incident-wrap) .incident{padding:18px 0}
    .long-report .incidents-wrap:not(.first-incident-wrap) .inc-desc{font-size:20pt!important;line-height:1.58}
    @page{margin:10mm}
  }`;

const SENSOR_CSS = `
  .sensor-cover{background:#111827;color:#f9fafb;padding:28px 48px 24px}
  .sc-eyebrow{font-size:11px;letter-spacing:.18em;color:#6b7280;text-transform:uppercase;margin-bottom:8px}
  .sc-title{font-size:24px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;margin-bottom:4px}
  .sc-period{font-size:13px;color:#9ca3af;margin-bottom:16px}
  .sc-stats{display:flex;gap:20px;flex-wrap:wrap;padding-top:14px;border-top:1px solid #374151}
  .sc-stat{text-align:center}
  .sc-val{font-size:20px;font-weight:700;color:#7dd3fc}
  .sc-key{font-size:9px;letter-spacing:.12em;color:#6b7280;margin-top:2px}
  .sensor-body{padding:24px 48px 48px}
  .section-head{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:12px}
  .zone-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
  .zone-table th{font-size:9px;letter-spacing:.1em;color:#9ca3af;text-align:left;padding:5px 8px;border-bottom:2px solid #e5e7eb;font-weight:700;background:#f9fafb}
  .zt{padding:7px 8px;border-bottom:1px solid #f3f4f6;font-size:13px;vertical-align:middle}
  .r{text-align:right!important}
  .clean-banner{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:12px 16px;color:#15803d;font-size:13px;font-weight:700;margin:16px 0}
  @media print{
    .sensor-cover{padding:16px 32px 14px}
    .sc-eyebrow{font-size:9pt}
    .sc-title{font-size:20pt}
    .sc-period{font-size:11pt}
    .sc-stats{gap:16px;padding-top:10px}
    .sc-val{font-size:17pt}
    .sc-key{font-size:8pt}
    .sensor-body{padding:16px 32px 32px}
    .zone-table th{font-size:8pt}
    .zt{font-size:11pt;padding:6px 7px}
  }`;

// Render the given full-document HTML to a PDF file and trigger a download.
// Bypasses Chrome's print pipeline entirely (Chrome 148+ blocked blob: URL
// printing). Uses html2canvas + jsPDF, slicing the rendered canvas across A4
// pages. Photos as data: URLs are handled natively.
async function downloadAsPdf(html: string, filename: string): Promise<void> {
  // Extract the <body> contents and <style> blocks from the full document.
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;
  const styleMatches = html.match(/<style[\s\S]*?<\/style>/gi) || [];
  const styleBlock = styleMatches.join("\n");
  const bodyClassMatch = html.match(/<body[^>]*class="([^"]*)"/i);
  const bodyClass = bodyClassMatch ? bodyClassMatch[1] : "";

  // Hidden render container sized like an A4 page at ~96 DPI.
  const RENDER_WIDTH = 794;
  const wrapper = document.createElement("div");
  wrapper.style.cssText = `position:fixed;left:-10000px;top:0;width:${RENDER_WIDTH}px;background:#fff;`;
  wrapper.innerHTML = `${styleBlock}<div class="${bodyClass}" style="background:#fff;width:${RENDER_WIDTH}px">${bodyContent.replace(/<script[\s\S]*?<\/script>/gi, "")}</div>`;
  document.body.appendChild(wrapper);

  try {
    // Wait for fonts + images to load before snapshotting.
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    const imgs = Array.from(wrapper.querySelectorAll("img"));
    await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise<void>(res => {
      img.onload = () => res();
      img.onerror = () => res();
    })));

    const canvas = await html2canvas(wrapper, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      width: RENDER_WIDTH,
      windowWidth: RENDER_WIDTH,
    });

    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/jpeg", 0.85);

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(filename);
  } finally {
    document.body.removeChild(wrapper);
  }
}

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "shift-log";
}

function buildIncidentBlocks(sorted: Incident[], photos: Record<string, string>): string[] {
  return sorted.map((inc, idx) => {
    const room = inc.building ? `${inc.building}${inc.room?" · "+inc.room:""}` : "General Facility";
    const photoHtml = inc.photoIds
      .map(pid => { const src = toSafeDataImage(photos[pid]); return src ? `<div class="photo-wrap"><img src="${src}" class="photo" alt=""/></div>` : ""; })
      .join("");
    return `
      <div class="incident${inc.urgent?" urgent":""}">
        <div class="inc-number${inc.urgent?" urgent-num":""}">${inc.urgent?"⚑ ":""}#${String(idx+1).padStart(2,"0")}${inc.urgent?" URGENT **":""}</div>
        <div class="inc-header">
          <div class="inc-left">
            <span class="inc-room">${escapeHtml(room)}</span>
            <span class="inc-cat">${escapeHtml(inc.category)}</span>
          </div>
          <div class="inc-time">${escapeHtml(inc.date)} &nbsp; ${escapeHtml(inc.time)}</div>
        </div>
        <div class="inc-desc">${escapeHtml(inc.description).replace(/\n/g,"<br>")}</div>
        ${photoHtml?`<div class="photos">${photoHtml}</div>`:""}
      </div>`;
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────
export async function generateReport(
  incidents: Incident[],
  sessionName: string,
  photos: Record<string, string>,
  mode: CompileMode = "incidents",
  fluxuumData?: FluxuumReport,
): Promise<void> {
  const sorted = [...incidents].sort((a, b) => {
    if (a.urgent && !b.urgent) return -1;
    if (!a.urgent && b.urgent) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const generatedAt = new Date().toLocaleString("en-US", {
    month:"short", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit",
  });
  const isLong = sorted.length >= 15;
  const blocks  = buildIncidentBlocks(sorted, photos);
  const first   = blocks[0] ?? "";
  const rest    = blocks.slice(1).join("");

  const eyebrow = mode === "merged"
    ? "Cultivation Facility — Incident Report + Sensor Analysis"
    : "Cultivation Facility — Incident Report";

  const sensorMeta = mode === "merged" && fluxuumData
    ? `<span>${fluxuumData.overview.totalReadings} sensor readings · ${fluxuumData.period.hours}h window</span>` : "";

  // ── Incident PDF ────────────────────────────────────────────────────────────
  const incidentDoc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Incident Report — ${escapeHtml(sessionName)}</title>
<style>${INCIDENT_CSS}${mode==="merged"?SENSOR_CSS:""}</style>
</head><body class="${isLong?"long-report":""}">
<div class="page">
  <div class="first-page-block">
    <div class="cover">
      <div class="cover-eyebrow">${eyebrow}</div>
      <div class="cover-title">Shift Log</div>
      <div class="cover-session">${escapeHtml(sessionName)}</div>
      <div class="cover-meta">
        <span>${sorted.length} incident${sorted.length!==1?"s":""} · chronological order</span>
        ${sensorMeta}
        <span>Generated ${generatedAt}</span>
      </div>
    </div>
    ${first?`<div class="incidents-wrap first-incident-wrap">${first}</div>`:""}
  </div>
  ${rest?`<div class="incidents-wrap">${rest}</div>`:""}
  ${mode==="merged"&&fluxuumData
    ? `${buildSensorCover(fluxuumData,true)}<div class="sensor-body">${buildSensorBody(fluxuumData)}</div>`
    : ""}
</div>
<script>window.onload=()=>{window.print();};<\/script>
</body></html>`;

  await downloadAsPdf(incidentDoc, `${safeFilename(sessionName)}-incidents.pdf`);

  // ── Separate sensor PDF ─────────────────────────────────────────────────────
  if (mode === "separate" && fluxuumData) {
    const sensorDoc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Sensor Report — ${escapeHtml(sessionName)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#fff;color:#1a1a1a;font-family:'JetBrains Mono','Courier New',monospace;font-size:17px;line-height:1.6}
  .page{width:100%;max-width:100%}
  ${SENSOR_CSS}
  .sensor-body{padding:40px 64px 80px}
  @media print{@page{margin:10mm}}
</style>
</head><body>
<div class="page">
  ${buildSensorCover(fluxuumData)}
  <div class="sensor-body">${buildSensorBody(fluxuumData)}</div>
</div>
<script>window.onload=()=>{window.print();};<\/script>
</body></html>`;
    await downloadAsPdf(sensorDoc, `${safeFilename(sessionName)}-sensors.pdf`);
  }
}
