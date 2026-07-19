#!/usr/bin/env node
"use strict";

// ============================================================
// CLAUDE CODE AMBASSADOR — standalone CLI
// Translate a Claude Code session dump into a plain-English debrief,
// printed straight to your terminal. Zero dependencies (Node builtins
// only). Needs ANTHROPIC_API_KEY in your environment.
//
// Usage:
//   ambassador session.log
//   cat session.log | ambassador
//   pbpaste | ambassador                 # macOS clipboard
//   ambassador --context stack.md session.log
// ============================================================

const fs = require("fs");
const https = require("https");
const path = require("path");
const os = require("os");

const SYSTEM_PROMPT = `You are the "Claude Code Ambassador" — a translator between Claude Code's dense agentic session output and a busy human who got distracted and just needs to know what happened.

The user will paste raw Claude Code session output (tool calls, background agents, eval numbers, diffs, verification reports, etc). Analyze it and respond with ONLY a JSON object — no markdown fences, no preamble — with this exact shape:

{
  "tldr": "1-2 sentence plain-English bottom line of the whole session",
  "what_happened": ["3-6 short plain-English bullets of what was actually done"],
  "numbers": [{"value": "96.8%", "meaning": "what this number actually means in plain terms"}],
  "decisions": ["decisions that were made or settled, if any"],
  "jargon": [{"term": "TrOCR", "plain": "one-line plain explanation of what this thing is"}],
  "touched_live": {"verdict": "untouched" | "touched" | "unclear", "detail": "one sentence on what live/production systems were or weren't modified"},
  "needs_response": {"required": true/false, "question": "what Claude Code is actually asking, if anything", "options": ["option a", "option b"]},
  "suggested_reply": "a short, ready-to-paste reply the user can send back to Claude Code (or empty string if none needed)"
}

Rules:
- Plain English. Assume the reader is smart but did not watch the session.
- Only include numbers/jargon/decisions arrays entries that actually appear in the paste. Empty arrays are fine.
- Never invent results. If something is ambiguous or cut off, say so in the relevant field.
- "touched_live" is the safety read: did the session modify production systems, live services, or deployed infrastructure? If the log doesn't say, verdict is "unclear".
- suggested_reply should be what YOU would type back — short, decisive, matching what the session actually needs.
- HARD BUDGET — your entire JSON must be COMPLETE and compact: tldr ≤ 2 sentences; ≤ 5 what_happened bullets of ≤ 20 words; ≤ 6 numbers with meanings ≤ 15 words; ≤ 4 decisions; ≤ 5 jargon entries; suggested_reply ≤ 40 words. Be ruthless — a complete short answer beats a truncated long one.`;

const MAX_INPUT_CHARS = 60000;
const MODEL = process.env.AMBASSADOR_MODEL || "claude-sonnet-5";
const DEFAULT_CONTEXT_PATHS = [
  path.join(process.cwd(), ".ambassador-context.md"),
  path.join(os.homedir(), ".ambassador", "context.md"),
];

// ---- ANSI colors (no deps) ----
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", white: "\x1b[37m",
};
const noColor = process.env.NO_COLOR || !process.stdout.isTTY;
function paint(color, s) { return noColor ? s : `${color}${s}${C.reset}`; }

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function parseArgs(argv) {
  const args = { context: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--context" || argv[i] === "-c") {
      args.context = argv[++i];
    } else if (argv[i] === "--model") {
      args.model = argv[++i];
    } else if (!argv[i].startsWith("-")) {
      args.file = argv[i];
    }
  }
  return args;
}

function loadStackContext(explicitPath) {
  const candidates = explicitPath ? [explicitPath] : DEFAULT_CONTEXT_PATHS;
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {}
  }
  return "";
}

// Salvage truncated JSON: close any open string, drop dangling keys/commas,
// then close every unclosed brace/bracket. Lets a cut-off response still render.
function repairJSON(raw) {
  let s = raw.trim();
  const start = s.indexOf("{");
  if (start === -1) throw new Error("no JSON found in response");
  s = s.slice(start);
  try {
    return { data: JSON.parse(s), repaired: false };
  } catch {}
  let inStr = false, esc = false;
  const stack = [];
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
  }
  if (inStr) s += '"';
  s = s.replace(/,\s*$/, "");
  s = s.replace(/"[^"\n]*"\s*:\s*$/, "");
  s = s.replace(/,\s*$/, "");
  while (stack.length) s += stack.pop() === "{" ? "}" : "]";
  return { data: JSON.parse(s), repaired: true };
}

function callClaude(apiKey, prompt) {
  const body = JSON.stringify({
    model: parseArgs(process.argv.slice(2)).model || MODEL,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });
  const options = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`API error ${res.statusCode}: ${data.slice(0, 500)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Couldn't parse API response as JSON: " + e.message));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function printDebrief(result) {
  const liveColors = { untouched: C.green, touched: C.red, unclear: C.yellow };
  const liveLabels = {
    untouched: "LIVE SYSTEMS: UNTOUCHED",
    touched: "LIVE SYSTEMS: MODIFIED",
    unclear: "LIVE SYSTEMS: UNCLEAR",
  };
  const verdict = result.touched_live?.verdict || "unclear";
  const liveColor = liveColors[verdict] || C.yellow;
  const liveLabel = liveLabels[verdict] || liveLabels.unclear;

  const line = (n = 60) => paint(C.dim, "─".repeat(n));
  const header = (label, color) => console.log("\n" + paint(color || C.cyan, paint(C.bold, label.toUpperCase())));

  console.log(paint(liveColor, paint(C.bold, `[ ${liveLabel} ]`)));
  if (result.touched_live?.detail) console.log(paint(C.dim, result.touched_live.detail));

  header("Bottom line", C.blue);
  console.log(result.tldr || "(none)");

  if (result.what_happened?.length) {
    header("What happened");
    for (const w of result.what_happened) console.log(paint(C.dim, "  - ") + w);
  }

  if (result.numbers?.length) {
    header("Numbers, decoded");
    for (const n of result.numbers) {
      console.log(paint(C.bold, "  " + n.value) + paint(C.dim, "  " + n.meaning));
    }
  }

  if (result.decisions?.length) {
    header("Decisions made", C.yellow);
    for (const d of result.decisions) console.log(paint(C.yellow, "  ✓ ") + d);
  }

  if (result.jargon?.length) {
    header("Jargon translator");
    for (const j of result.jargon) {
      console.log("  " + paint(C.cyan, j.term) + paint(C.dim, " -> ") + j.plain);
    }
  }

  header("How to respond", C.green);
  if (result.needs_response?.required) {
    console.log(paint(C.dim, "  It's asking: ") + result.needs_response.question);
    for (const [i, o] of (result.needs_response.options || []).entries()) {
      console.log(paint(C.dim, `    [${i + 1}] `) + o);
    }
  } else {
    console.log(paint(C.dim, "  No open question - nothing is blocked on you."));
  }
  if (result.suggested_reply) {
    console.log();
    console.log(paint(C.dim, "  READY-TO-PASTE REPLY:"));
    console.log("  " + result.suggested_reply);
  }
  console.log("\n" + line());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(paint(C.red, "ANTHROPIC_API_KEY is not set. Export it and try again."));
    process.exit(1);
  }

  let session;
  if (args.file) {
    try {
      session = fs.readFileSync(args.file, "utf8");
    } catch (e) {
      console.error(paint(C.red, `Couldn't read ${args.file}: ${e.message}`));
      process.exit(1);
    }
  } else {
    session = await readStdin();
  }
  if (!session || !session.trim()) {
    console.error(paint(C.red, "No session text given. Pipe it in, or pass a file path."));
    console.error(paint(C.dim, "Usage: ambassador session.log   |   cat session.log | ambassador"));
    process.exit(1);
  }

  const stackContext = loadStackContext(args.context);

  let payload = session;
  let trimmed = false;
  if (payload.length > MAX_INPUT_CHARS) {
    payload =
      payload.slice(0, 8000) +
      "\n\n[... middle of session trimmed for length ...]\n\n" +
      payload.slice(-45000);
    trimmed = true;
  }

  const prompt = `${SYSTEM_PROMPT}\n\n${stackContext}\n\n=== CLAUDE CODE SESSION OUTPUT ===\n${payload}`;

  process.stderr.write(paint(C.dim, "translating...\n"));
  let response;
  try {
    response = await callClaude(apiKey, prompt);
  } catch (e) {
    console.error(paint(C.red, "Request failed: " + e.message));
    process.exit(1);
  }

  const text = (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const clean = text.replace(/```json|```/g, "").trim();

  let parsed, repaired;
  try {
    ({ data: parsed, repaired } = repairJSON(clean));
  } catch (e) {
    console.error(paint(C.red, "Couldn't parse the response even after repair: " + e.message));
    console.error(paint(C.dim, "Raw response:\n") + text);
    process.exit(1);
  }

  printDebrief(parsed);
  if (trimmed) console.error(paint(C.yellow, "\n(note: input was oversized - middle of the session was trimmed)"));
  if (repaired) console.error(paint(C.yellow, "(note: response hit the length limit - last section may be incomplete)"));
}

if (require.main === module) {
  main();
}

module.exports = { repairJSON, printDebrief, parseArgs, loadStackContext };
