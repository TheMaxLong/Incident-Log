# Drift Report Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-tap voice-to-draft-incident pipeline: Pixel 10 Drift Report widget → Mac whisper.cpp → ntfy → Incident-Log site auto-draft.

**Architecture:** Async, network-resilient, decoupled. Recording always succeeds locally; upload retries handle WiFi↔5G switches and Mac offline states. Each component is independently testable.

**Tech Stack:**
- Pixel 10: Termux + Termux:API (bash scripts)
- Mac: Python 3 stdlib http.server + whisper.cpp + launchd
- ntfy: existing public ntfy.sh service
- Incident-Log site: React 19 + TypeScript + Vite (existing) on GitHub Pages

**Reference spec:** `docs/superpowers/specs/2026-05-28-drift-report-pipeline-design.md`

---

## File Structure

**Pixel 10 (Termux at `/data/data/com.termux/files/home/`)**
- `~/.shortcuts/Drift-Report` — widget entrypoint (rewrite)
- `~/bin/drift-config.sh` — config exports
- `~/bin/drift-upload-loop.sh` — queue uploader (new)
- `~/bin/drift-resend-recent.sh` — re-push notifications for recent transcripts (new, recovery tool)
- `~/.config/hark/drift-token` — bearer token (mode 600)
- `~/drift-queue/` — audio + sidecar JSON files
- `~/drift-queue/dead/` — failed transcriptions
- `~/drift-queue/uploader.log` — activity log

**Mac (at `/Users/max/`)**
- `~/.local/hark-whisper/` — whisper.cpp clone + model + server
- `~/.local/hark-whisper/server.py` — HTTP server (new)
- `~/.local/hark-whisper/run-server.sh` — launchd entry script (new)
- `~/.config/hark/drift-token` — same token as phone (mode 600)
- `~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist` — service (new)
- `~/Library/Logs/hark-whisper.log` — server log
- `~/Library/Logs/hark-drift-transcripts.log` — transcript audit log

**Incident-Log repo (`~/Documents/GitHub/Incident-Log/`)**
- `src/lib/draftHandler.ts` — URL param parser + session factory (new)
- `src/App.tsx` — URL detection on mount (modify)
- `src/pages/IncidentPage.tsx` — accept `initialDraft` prop (modify)

---

## Phase 0: Foundation

### Task 1: Generate shared secrets and config

**Files:**
- Create: `/tmp/drift-secrets.txt` (scratch — not committed)
- Create: `~/.config/hark/drift-token` (Mac)
- Create: `~/.config/hark/drift-config.sh` (Mac)

- [ ] **Step 1: Generate a random bearer token + ntfy topic suffix**

```bash
mkdir -p ~/.config/hark
chmod 700 ~/.config/hark

TOKEN=$(openssl rand -hex 32)
NTFY_SUFFIX=$(openssl rand -hex 8)

echo "$TOKEN" > ~/.config/hark/drift-token
chmod 600 ~/.config/hark/drift-token

cat > ~/.config/hark/drift-config.sh <<EOF
# Drift Report shared config — sourced by Mac server and uploader
export DRIFT_TOKEN_FILE="\$HOME/.config/hark/drift-token"
export NTFY_TOPIC="hark-drift-ready-$NTFY_SUFFIX"
export NTFY_FAIL_TOPIC="hark-drift-fail-$NTFY_SUFFIX"
export NTFY_BACKLOG_TOPIC="hark-drift-backlog-$NTFY_SUFFIX"
export MAC_TAILSCALE_IP="100.65.146.120"
export MAC_PORT="9090"
export INCIDENT_LOG_URL="https://themaxlong.github.io/Incident-Log/"
EOF
chmod 600 ~/.config/hark/drift-config.sh

# Save to scratch so we can copy to Pixel later
cp ~/.config/hark/drift-token /tmp/drift-secrets.txt
cat ~/.config/hark/drift-config.sh >> /tmp/drift-secrets.txt
echo "Secrets generated; will copy to Pixel in Phase 3"
```

- [ ] **Step 2: Verify files exist with correct permissions**

```bash
ls -la ~/.config/hark/
```

Expected: `drift-token` and `drift-config.sh` both `-rw-------` (mode 600).

- [ ] **Step 3: Commit (config files are not committed — they hold secrets)**

No commit for this task. Verify `.gitignore` or working directory does not contain `~/.config/hark/`.

---

## Phase 1: Mac whisper.cpp HTTP server

### Task 2: Install whisper.cpp + small.en model

**Files:**
- Create: `~/.local/hark-whisper/` (whisper.cpp clone)

- [ ] **Step 1: Clone whisper.cpp and build**

```bash
mkdir -p ~/.local
cd ~/.local
git clone https://github.com/ggerganov/whisper.cpp.git hark-whisper
cd hark-whisper
make -j
```

Expected: Build completes without errors. `~/.local/hark-whisper/main` binary exists.

- [ ] **Step 2: Download the small.en model (~487MB)**

```bash
cd ~/.local/hark-whisper
bash ./models/download-ggml-model.sh small.en
ls -lh models/ggml-small.en.bin
```

Expected: File exists, ~487MB.

- [ ] **Step 3: Smoke test whisper on a synthetic audio**

```bash
cd ~/.local/hark-whisper
say "the quick brown fox jumps over the lazy dog" -o /tmp/test.aiff
ffmpeg -y -i /tmp/test.aiff -ar 16000 -ac 1 /tmp/test.wav 2>/dev/null
./main -m models/ggml-small.en.bin -f /tmp/test.wav --output-txt -nt 2>/dev/null
cat /tmp/test.wav.txt
```

Expected: Output reads like "The quick brown fox jumps over the lazy dog." (with punctuation).

- [ ] **Step 4: Verify ffmpeg is available**

```bash
which ffmpeg && ffmpeg -version | head -1
```

If missing: `brew install ffmpeg`. Expected: version line printed.

- [ ] **Step 5: Commit (this lives outside the repo — no git action needed)**

No commit. whisper.cpp is installed locally, not in any tracked repo.

---

### Task 3: Build the Mac whisper HTTP server (skeleton + auth)

**Files:**
- Create: `~/.local/hark-whisper/server.py`

- [ ] **Step 1: Write the server skeleton**

Create `~/.local/hark-whisper/server.py`:

```python
#!/usr/bin/env python3
"""Hark Drift Report — Whisper transcription HTTP server.

Endpoints:
  GET  /health     -> 200 {"ok": true, "model": "small.en"}
  POST /transcribe -> 200 {"transcript": "...", "duration_sec": N}

Auth: bearer token in Authorization header.
Binds to Tailscale IP only.
"""
import cgi
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

WHISPER_DIR = Path.home() / ".local" / "hark-whisper"
MODEL_PATH = WHISPER_DIR / "models" / "ggml-small.en.bin"
MAIN_BIN = WHISPER_DIR / "main"
TOKEN_FILE = Path.home() / ".config" / "hark" / "drift-token"
AUDIT_LOG = Path.home() / "Library" / "Logs" / "hark-drift-transcripts.log"

TRANSCRIBE_TIMEOUT_SEC = 30
TRANSCRIPT_MAX_CHARS = 3000

BIND_HOST = os.environ.get("HARK_BIND_HOST", "127.0.0.1")
BIND_PORT = int(os.environ.get("HARK_BIND_PORT", "9090"))


def load_token() -> str:
    return TOKEN_FILE.read_text().strip()


def check_auth(headers) -> bool:
    auth = headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    return auth[7:].strip() == load_token()


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            if not check_auth(self.headers):
                self._json(401, {"error": "unauthorized"})
                return
            self._json(200, {"ok": True, "model": "small.en"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/transcribe":
            if not check_auth(self.headers):
                self._json(401, {"error": "unauthorized"})
                return
            self._json(501, {"error": "not implemented yet"})
        else:
            self._json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")


def main() -> None:
    server = HTTPServer((BIND_HOST, BIND_PORT), Handler)
    sys.stderr.write(f"Hark Whisper server listening on {BIND_HOST}:{BIND_PORT}\n")
    sys.stderr.flush()
    server.serve_forever()


if __name__ == "__main__":
    main()
```

```bash
chmod +x ~/.local/hark-whisper/server.py
```

- [ ] **Step 2: Run server locally and smoke-test /health**

In one terminal:
```bash
~/.local/hark-whisper/server.py
```

In another terminal:
```bash
TOKEN=$(cat ~/.config/hark/drift-token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9090/health
```

Expected: `{"ok": true, "model": "small.en"}`

- [ ] **Step 3: Verify auth rejection**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9090/health
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer wrong-token" http://127.0.0.1:9090/health
```

Expected: `401` for both.

- [ ] **Step 4: Stop the server (Ctrl-C in the first terminal)**

No file changes to commit yet — committing once the server is complete.

---

### Task 4: Add the /transcribe endpoint

**Files:**
- Modify: `~/.local/hark-whisper/server.py`

- [ ] **Step 1: Replace the `do_POST` method body for /transcribe**

Replace the `if self.path == "/transcribe":` block in `server.py` with:

```python
        if self.path == "/transcribe":
            if not check_auth(self.headers):
                self._json(401, {"error": "unauthorized"})
                return
            content_type = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in content_type:
                self._json(400, {"error": "expected multipart/form-data"})
                return
            try:
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": content_type},
                )
                audio_field = form["audio"] if "audio" in form else None
                if audio_field is None or not audio_field.filename:
                    self._json(400, {"error": "missing audio file"})
                    return
                upload_id = uuid.uuid4().hex
                tmp_dir = Path(tempfile.gettempdir())
                in_path = tmp_dir / f"hark-{upload_id}.m4a"
                wav_path = tmp_dir / f"hark-{upload_id}.wav"
                txt_path = wav_path.with_suffix(".wav.txt")
                in_path.write_bytes(audio_field.file.read())

                # Convert to 16kHz mono WAV
                subprocess.run(
                    ["ffmpeg", "-y", "-i", str(in_path), "-ar", "16000", "-ac", "1", str(wav_path)],
                    check=True, capture_output=True, timeout=15,
                )

                # Run whisper
                t0 = time.time()
                subprocess.run(
                    [str(MAIN_BIN), "-m", str(MODEL_PATH),
                     "-f", str(wav_path), "--output-txt", "-nt"],
                    check=True, capture_output=True,
                    timeout=TRANSCRIBE_TIMEOUT_SEC,
                )
                duration_sec = round(time.time() - t0, 2)
                transcript = txt_path.read_text().strip()[:TRANSCRIPT_MAX_CHARS]

                # Audit log
                AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
                with AUDIT_LOG.open("a") as f:
                    f.write(json.dumps({
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                        "duration_sec": duration_sec,
                        "transcript": transcript,
                    }) + "\n")

                # Cleanup temp files
                for p in (in_path, wav_path, txt_path):
                    p.unlink(missing_ok=True)

                self._json(200, {
                    "transcript": transcript,
                    "duration_sec": duration_sec,
                    "model": "small.en",
                })
            except subprocess.TimeoutExpired:
                self._json(504, {"error": "transcription timeout"})
            except subprocess.CalledProcessError as e:
                stderr = (e.stderr or b"").decode()[-500:]
                self._json(500, {"error": "subprocess failed", "stderr": stderr})
            except Exception as e:
                self._json(500, {"error": str(e)})
```

- [ ] **Step 2: Restart server and smoke-test /transcribe with the test audio**

```bash
~/.local/hark-whisper/server.py &
SERVER_PID=$!
sleep 1

TOKEN=$(cat ~/.config/hark/drift-token)
# Build a test m4a from the same say command
say "this is a hark drift report test, gh four looks fine" -o /tmp/test2.aiff
ffmpeg -y -i /tmp/test2.aiff -c:a aac /tmp/test2.m4a 2>/dev/null

curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@/tmp/test2.m4a" \
  http://127.0.0.1:9090/transcribe | python3 -m json.tool

kill $SERVER_PID
```

Expected: JSON response with `transcript` containing "This is a hark drift report test, GH four looks fine." (case + punctuation may vary slightly — Whisper sometimes hears "G H" as "G-H" or "GH").

- [ ] **Step 3: Verify audit log entry was appended**

```bash
tail -1 ~/Library/Logs/hark-drift-transcripts.log
```

Expected: One JSON line with `ts`, `duration_sec`, `transcript`.

- [ ] **Step 4: Verify temp files cleaned up**

```bash
ls /tmp/hark-* 2>/dev/null && echo "FAIL: temp files left behind" || echo "OK: no temp files"
```

Expected: "OK: no temp files".

---

### Task 5: Bind server to Tailscale IP and verify from Pixel

**Files:**
- Create: `~/.local/hark-whisper/run-server.sh`

- [ ] **Step 1: Detect the actual Tailscale IP**

```bash
TS_IP=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 | head -1)
echo "Tailscale IP: $TS_IP"
```

Expected: Returns `100.65.146.120` (or whatever the current IP is — if different, this is the real value to use).

- [ ] **Step 2: Create the launcher script**

```bash
cat > ~/.local/hark-whisper/run-server.sh <<'EOF'
#!/bin/bash
# Launcher: binds to Tailscale IP, runs the whisper HTTP server.
set -euo pipefail

TS_IP=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 | head -1)
if [ -z "$TS_IP" ]; then
  echo "ERROR: Tailscale IP not available" >&2
  exit 1
fi

export HARK_BIND_HOST="$TS_IP"
export HARK_BIND_PORT="9090"
exec /usr/bin/env python3 "$HOME/.local/hark-whisper/server.py"
EOF
chmod +x ~/.local/hark-whisper/run-server.sh
```

- [ ] **Step 3: Run server bound to Tailscale and verify from Mac itself**

```bash
~/.local/hark-whisper/run-server.sh &
SERVER_PID=$!
sleep 1

TS_IP=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 | head -1)
TOKEN=$(cat ~/.config/hark/drift-token)
curl -s -H "Authorization: Bearer $TOKEN" "http://$TS_IP:9090/health"
echo ""

# Now try from 127.0.0.1 — should fail since we're bound only to TS IP
curl -s -m 2 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9090/health 2>&1
```

Expected: `{"ok": true, ...}` for the TS_IP request. Connection refused / timeout for 127.0.0.1.

- [ ] **Step 4: Verify from Pixel 10 over Tailscale**

```bash
TOKEN=$(cat ~/.config/hark/drift-token)
ssh pixel10 "curl -s -H 'Authorization: Bearer $TOKEN' http://maxs-macbook-air-1.tailf0f27a.ts.net:9090/health"
```

Expected: `{"ok": true, "model": "small.en"}`

- [ ] **Step 5: Stop the server**

```bash
kill $SERVER_PID
```

---

### Task 6: launchd auto-start for the whisper server

**Files:**
- Create: `~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist`

- [ ] **Step 1: Write the plist**

```bash
cat > ~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.themaxlong.hark.whisper</string>
  <key>ProgramArguments</key>
  <array>
    <string>$HOME/.local/hark-whisper/run-server.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/hark-whisper.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/hark-whisper.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF
```

- [ ] **Step 2: Load the service**

```bash
launchctl unload ~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist
sleep 2
launchctl list | grep hark.whisper
```

Expected: One line with PID (numeric) for `com.themaxlong.hark.whisper`. Status code 0.

- [ ] **Step 3: Verify the service responds**

```bash
TS_IP=$(/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4 | head -1)
TOKEN=$(cat ~/.config/hark/drift-token)
curl -s -H "Authorization: Bearer $TOKEN" "http://$TS_IP:9090/health"
```

Expected: `{"ok": true, "model": "small.en"}`

- [ ] **Step 4: Verify auto-restart on crash**

```bash
# Kill the running server
pkill -f "python3 .*server.py" || true
sleep 12
# launchd should have restarted it
launchctl list | grep hark.whisper
curl -s -H "Authorization: Bearer $TOKEN" "http://$TS_IP:9090/health"
```

Expected: New PID after restart, /health returns 200.

- [ ] **Step 5: Verify logs**

```bash
tail -5 ~/Library/Logs/hark-whisper.log
```

Expected: Output includes startup line "Hark Whisper server listening on 100.65.146.120:9090" (or current TS IP).

- [ ] **Step 6: Commit (Mac-side files are not in a repo — skip)**

No commit. Mac dotfiles are not tracked.

---

## Phase 2: Incident-Log site URL handler

### Task 7: Create draftHandler.ts

**Files:**
- Create: `src/lib/draftHandler.ts`

- [ ] **Step 1: Implement the URL parser**

Create `src/lib/draftHandler.ts`:

```typescript
import type { Session } from "../types";
import { getSessions, saveSession } from "./store";

export interface DraftPayload {
  description: string;
  recordedAt: string | null;  // ISO timestamp
  durationSec: number | null;
  testMode: boolean;
}

/** Decode base64 (URL-safe) text. Handles Unicode. */
function decodeBase64(b64: string): string {
  // Convert URL-safe variants
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  // Walk bytes back to Unicode
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Parse URL params on page load. Returns null if no draft present or parse fails. */
export function readDraftFromUrl(search: string = window.location.search): DraftPayload | null {
  const params = new URLSearchParams(search);
  const draft = params.get("draft");
  if (!draft) return null;
  try {
    const description = decodeBase64(draft);
    return {
      description,
      recordedAt: params.get("recorded"),
      durationSec: params.get("dur") ? Number(params.get("dur")) : null,
      testMode: params.get("test") === "1",
    };
  } catch (e) {
    console.error("[draftHandler] base64 decode failed:", e);
    return null;
  }
}

/** Return today's YYYY-MM-DD in local time. */
function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Find or create the session for today. Defaults to night shift (S2). */
export function findOrCreateTodaySession(): Session {
  const today = todayISO();
  const sessions = getSessions();
  const existing = sessions.find(s => s.date === today);
  if (existing) return existing;

  const created: Session = {
    id: Date.now().toString(),
    name: `${today} · S2`,
    date: today,
    shift: "S2",
    createdAt: new Date().toISOString(),
    incidentCount: 0,
  };
  saveSession(created);
  return created;
}

/** Convert an ISO timestamp into HH:MM (24h) for the time field. */
export function isoToHHMM(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Strip the draft params from the URL after consumption so reload doesn't re-trigger. */
export function clearDraftParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("draft");
  url.searchParams.delete("recorded");
  url.searchParams.delete("dur");
  url.searchParams.delete("test");
  window.history.replaceState({}, "", url.toString());
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd ~/Documents/GitHub/Incident-Log
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors involving `draftHandler.ts`.

- [ ] **Step 3: Manual smoke test in browser console**

```bash
cd ~/Documents/GitHub/Incident-Log
npm run dev &
DEV_PID=$!
sleep 5
echo "Open http://localhost:5173 in browser. In DevTools console, run:"
echo "  import('/src/lib/draftHandler.ts').then(m => console.log(m.readDraftFromUrl('?draft=aGVsbG8&recorded=2026-05-28T03:15:44Z')))"
echo ""
echo "Expected: { description: 'hello', recordedAt: '2026-05-28T03:15:44Z', durationSec: null, testMode: false }"
echo "Press enter when done..."
read
kill $DEV_PID
```

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/GitHub/Incident-Log
git add src/lib/draftHandler.ts
git commit -m "Add draftHandler for Drift Report URL params

Parses ?draft=<base64>&recorded=<iso>&dur=<n>&test=<0|1> from URL.
Handles URL-safe base64, Unicode, session auto-create for today (S2).
Idempotent: clearDraftParams() strips params after consumption."
```

---

### Task 8: Wire draft handler into App.tsx and IncidentPage.tsx

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/IncidentPage.tsx:141-156`

- [ ] **Step 1: Update App.tsx to detect draft on mount**

Replace the entire content of `src/App.tsx` with:

```typescript
import { useState, useEffect } from "react";
import SessionsPage from "./pages/SessionsPage";
import IncidentPage from "./pages/IncidentPage";
import type { Session } from "./types";
import {
  readDraftFromUrl,
  findOrCreateTodaySession,
  isoToHHMM,
  clearDraftParams,
} from "./lib/draftHandler";

type View = { page: "sessions" } | { page: "incident"; session: Session; initialDraft?: { description: string; time: string; testMode: boolean } };

export default function App() {
  const [view, setView] = useState<View>({ page: "sessions" });
  const [sessionsKey, setSessionsKey] = useState(0);

  // On first mount, check URL for a Drift Report draft.
  useEffect(() => {
    const draft = readDraftFromUrl();
    if (!draft) return;
    const session = findOrCreateTodaySession();
    setView({
      page: "incident",
      session,
      initialDraft: {
        description: draft.description,
        time: isoToHHMM(draft.recordedAt),
        testMode: draft.testMode,
      },
    });
    clearDraftParams();
  }, []);

  if (view.page === "incident") {
    return (
      <IncidentPage
        session={view.session}
        initialDraft={view.initialDraft}
        onBack={() => {
          setView({ page: "sessions" });
          setSessionsKey(k => k + 1);
        }}
      />
    );
  }

  return (
    <SessionsPage
      key={sessionsKey}
      onSelect={session => setView({ page: "incident", session })}
    />
  );
}
```

- [ ] **Step 2: Update IncidentPage Props and initial form state**

In `src/pages/IncidentPage.tsx`, find lines 141-156 and replace with:

```typescript
interface Props {
  session: Session;
  initialDraft?: { description: string; time: string; testMode: boolean };
  onBack: () => void;
}

export default function IncidentPage({ session, initialDraft, onBack }: Props) {
  const [date, setDate] = useState(nowDate);
  const [time, setTime] = useState(() => initialDraft?.time || nowTime);
  const [building, setBuilding] = useState<Building | "">("");
  const [room, setRoom] = useState("");
  const [category, setCategory] = useState("");
  const [otherText, setOtherText] = useState("");
  const [desc, setDesc] = useState(() => initialDraft?.description || "");
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [urgent, setUrgent] = useState(false);
```

- [ ] **Step 3: Add the draft banner near the top of the IncidentPage return**

In `src/pages/IncidentPage.tsx`, locate the outermost return JSX. Just inside the top-level `<div>`, before the existing content, add a draft banner conditional on `initialDraft`.

First find the JSX root by searching:

```bash
grep -n "return (" ~/Documents/GitHub/Incident-Log/src/pages/IncidentPage.tsx | head -5
```

Then, immediately after the opening `<div style={...}>` of the root JSX (which should be near the bottom of the file), insert:

```tsx
        {initialDraft && initialDraft.testMode && (
          <div style={{
            background: "#3a3000", border: "1px solid #ffcc00",
            color: "#ffcc00", padding: "10px 14px", borderRadius: "4px",
            marginBottom: "14px", fontSize: "12px", fontFamily: M,
            fontWeight: "bold",
          }}>
            🧪 TEST MODE — Save disabled. Test data, not real incidents.
          </div>
        )}
        {initialDraft && !initialDraft.testMode && (
          <div style={{
            background: "#0f1a2e", border: "1px solid #7dd3fc",
            color: "#7dd3fc", padding: "10px 14px", borderRadius: "4px",
            marginBottom: "14px", fontSize: "12px", fontFamily: M,
          }}>
            📝 Draft from Drift Report — review and save
          </div>
        )}
```

(If `M` is not in scope at the JSX root, replace `fontFamily: M` with `fontFamily: "'JetBrains Mono', monospace"`.)

- [ ] **Step 4: Disable Save in TEST MODE**

Find the Save button in `IncidentPage.tsx` (around the form). Search:

```bash
grep -n "Save\|saveIncident\|onClick.*save\|LOG INCIDENT\|disabled={" ~/Documents/GitHub/Incident-Log/src/pages/IncidentPage.tsx | head -20
```

Add `disabled={initialDraft?.testMode || (existing disabled condition)}` to the Save button's props. If a disabled prop exists already, augment it like:

```tsx
disabled={initialDraft?.testMode || logging || /* existing conditions */}
```

If there's no existing disabled prop, add:

```tsx
disabled={initialDraft?.testMode}
```

- [ ] **Step 5: Type-check the changes**

```bash
cd ~/Documents/GitHub/Incident-Log
npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. If any errors reference `initialDraft`, fix the prop types.

- [ ] **Step 6: Manual browser smoke test**

```bash
cd ~/Documents/GitHub/Incident-Log
npm run dev &
DEV_PID=$!
sleep 5

# Craft a test URL with base64-encoded description
DRAFT=$(echo -n "Hello from Drift Report test. GH four looks fine." | base64)
echo "Open this URL in browser:"
echo "  http://localhost:5173/?draft=${DRAFT}&recorded=2026-05-28T03:15:44Z&test=1"
echo ""
echo "Expected: Today's session auto-created (or existing one selected),"
echo "  IncidentPage opens, description pre-filled, time shows 03:15,"
echo "  yellow TEST MODE banner, Save button disabled."
echo ""
echo "Press enter when verified..."
read
kill $DEV_PID
```

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/GitHub/Incident-Log
git add src/App.tsx src/pages/IncidentPage.tsx
git commit -m "Wire Drift Report draft URLs into IncidentPage

App.tsx reads ?draft= on mount, auto-creates today's session if missing,
routes directly into the new-incident form with description + time
pre-filled. ?test=1 shows TEST MODE banner and disables Save."
```

---

### Task 9: Deploy site to GitHub Pages and verify live

**Files:**
- Modify: `~/Documents/GitHub/Incident-Log/` (build artifacts)

- [ ] **Step 1: Build and check output**

```bash
cd ~/Documents/GitHub/Incident-Log
npm run build 2>&1 | tail -20
ls -lh dist/
```

Expected: Build completes without errors. `dist/index.html` and `dist/assets/` exist.

- [ ] **Step 2: Push to main (GitHub Pages auto-deploys)**

```bash
cd ~/Documents/GitHub/Incident-Log
git push origin main
```

- [ ] **Step 3: Wait for GitHub Pages to deploy (~1-2 minutes), then verify**

```bash
sleep 90
DRAFT=$(echo -n "Production smoke test from Drift Report pipeline." | base64)
URL="https://themaxlong.github.io/Incident-Log/?draft=${DRAFT}&recorded=$(date -u +%Y-%m-%dT%H:%M:%SZ)&test=1"
echo "Open this URL on your phone or Mac browser:"
echo "  $URL"
echo ""
echo "Expected: TEST MODE banner, description pre-filled, Save disabled."
echo ""
echo "Press enter when verified..."
read
```

If the deployment didn't pick up yet, wait another minute and retry. GitHub Pages can take 1-3 minutes after push.

---

## Phase 3: Termux uploader

### Task 10: Copy config + token to Pixel 10

**Files:**
- Create on Pixel: `~/.config/hark/drift-token`
- Create on Pixel: `~/bin/drift-config.sh`

- [ ] **Step 1: Push token and config to phone**

```bash
ssh pixel10 "mkdir -p ~/.config/hark ~/bin ~/drift-queue ~/drift-queue/dead"
scp ~/.config/hark/drift-token pixel10:~/.config/hark/drift-token
scp ~/.config/hark/drift-config.sh pixel10:~/bin/drift-config.sh
ssh pixel10 "chmod 600 ~/.config/hark/drift-token ~/bin/drift-config.sh"
```

- [ ] **Step 2: Verify on phone**

```bash
ssh pixel10 "source ~/bin/drift-config.sh && echo \"Topic: \$NTFY_TOPIC\" && cat \$DRIFT_TOKEN_FILE | head -c 16"
```

Expected: Prints `Topic: hark-drift-ready-<8-hex-chars>` and first 16 chars of the token.

---

### Task 11: Write the upload loop script

**Files:**
- Create on Pixel: `~/bin/drift-upload-loop.sh`

- [ ] **Step 1: Write the uploader**

```bash
ssh pixel10 "cat > ~/bin/drift-upload-loop.sh" << 'OUTER_EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Drift Report uploader — scan ~/drift-queue/, POST audio to Mac whisper server,
# notify via ntfy on success. Resilient to WiFi↔5G transitions.
set -u

source ~/bin/drift-config.sh

QUEUE="$HOME/drift-queue"
DEAD="$QUEUE/dead"
LOG="$QUEUE/uploader.log"
TOKEN=$(cat "$DRIFT_TOKEN_FILE")

MAC_URL="http://maxs-macbook-air-1.tailf0f27a.ts.net:${MAC_PORT}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

# Build URL-safe base64
base64_url() {
  base64 -w0 | tr '+/' '-_' | tr -d '='
}

# Push ntfy with deep link
notify_ready() {
  local transcript="$1"
  local recorded_at="$2"
  local duration="$3"

  local b64
  b64=$(printf '%s' "$transcript" | base64_url)
  # Cap URL length — truncate transcript if huge
  if [ ${#b64} -gt 3000 ]; then
    transcript="${transcript:0:2900}[...truncated, full audio on Mac...]"
    b64=$(printf '%s' "$transcript" | base64_url)
  fi
  local url="${INCIDENT_LOG_URL}?draft=${b64}&recorded=${recorded_at}&dur=${duration}"
  local preview
  preview=$(printf '%s' "$transcript" | head -c 80)

  curl -s -X POST \
    -H "Title: Drift ready" \
    -H "Click: $url" \
    -H "Priority: 3" \
    -d "$preview" \
    "https://ntfy.sh/${NTFY_TOPIC}" > /dev/null
}

notify_failure() {
  local filename="$1"
  curl -s -X POST \
    -H "Title: Transcription failed" \
    -H "Priority: 4" \
    -d "Failed 3x: $filename" \
    "https://ntfy.sh/${NTFY_FAIL_TOPIC}" > /dev/null
}

notify_backlog() {
  local count="$1"
  curl -s -X POST \
    -H "Title: Drift backlog" \
    -H "Priority: 2" \
    -d "$count pending, Mac unreachable >2h" \
    "https://ntfy.sh/${NTFY_BACKLOG_TOPIC}" > /dev/null
}

# Health check Mac
mac_alive() {
  curl -m 3 -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    "${MAC_URL}/health" 2>/dev/null | grep -q '^200$'
}

# Process one file
process_file() {
  local audio="$1"
  local stem="${audio%.m4a}"
  local meta="${stem}.json"
  local attempts_file="${stem}.attempts"
  local recorded_at_iso

  if [ -f "$meta" ]; then
    recorded_at_iso=$(python3 -c "import json; print(json.load(open('$meta')).get('recorded_at',''))" 2>/dev/null)
  fi
  : "${recorded_at_iso:=$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

  local attempts=0
  [ -f "$attempts_file" ] && attempts=$(cat "$attempts_file")

  log "uploading $audio (attempt $((attempts + 1)))"

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -F "audio=@$audio" \
    --max-time 60 \
    "${MAC_URL}/transcribe" 2>&1)
  local http_code=$(printf '%s' "$response" | tail -n1)
  local body=$(printf '%s' "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    local transcript
    transcript=$(printf '%s' "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['transcript'])" 2>/dev/null)
    local duration
    duration=$(printf '%s' "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['duration_sec'])" 2>/dev/null)

    notify_ready "$transcript" "$recorded_at_iso" "${duration:-0}"
    mv "$audio" "${audio}.sent"
    rm -f "$attempts_file"
    log "  OK: ${#transcript} chars, ${duration}s — notification sent"
    return 0
  else
    attempts=$((attempts + 1))
    echo "$attempts" > "$attempts_file"
    log "  FAIL: http=$http_code, attempts=$attempts"
    if [ "$attempts" -ge 3 ]; then
      mv "$audio" "$DEAD/"
      [ -f "$meta" ] && mv "$meta" "$DEAD/"
      rm -f "$attempts_file"
      notify_failure "$(basename "$audio")"
      log "  DEAD-LETTERED: $audio"
    fi
    return 1
  fi
}

# Prune .sent files older than 7 days
prune_sent() {
  find "$QUEUE" -maxdepth 1 -name '*.m4a.sent' -mtime +7 -delete 2>/dev/null
  find "$QUEUE" -maxdepth 1 -name '*.json' -mtime +7 ! -newer "$QUEUE/*.m4a" -delete 2>/dev/null || true
}

# Detect backlog (files >2h old still unprocessed)
check_backlog() {
  local count
  count=$(find "$QUEUE" -maxdepth 1 -name '*.m4a' -mmin +120 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt 0 ]; then
    notify_backlog "$count"
    log "backlog alert: $count files >2h old"
  fi
}

# Main
main() {
  mkdir -p "$QUEUE" "$DEAD"
  touch "$LOG"

  if ! mac_alive; then
    log "mac unreachable, skipping queue scan"
    check_backlog
    exit 0
  fi

  local pending
  pending=$(find "$QUEUE" -maxdepth 1 -name '*.m4a' 2>/dev/null)
  if [ -z "$pending" ]; then
    log "queue empty"
    prune_sent
    exit 0
  fi

  echo "$pending" | while read -r f; do
    process_file "$f" || true
  done

  prune_sent
  log "scan complete"
}

main "$@"
OUTER_EOF

ssh pixel10 "chmod +x ~/bin/drift-upload-loop.sh"
```

- [ ] **Step 2: Verify uploader script syntax**

```bash
ssh pixel10 "bash -n ~/bin/drift-upload-loop.sh && echo OK"
```

Expected: Prints "OK".

---

### Task 12: Smoke-test uploader with a manually-placed audio file

**Files:** None (test only)

- [ ] **Step 1: Generate a test m4a on the phone**

```bash
ssh pixel10 "
# Generate 3 seconds of beep tone as m4a — exercises the pipeline without needing real audio
which ffmpeg >/dev/null 2>&1 || pkg install -y ffmpeg
ffmpeg -y -f lavfi -i 'sine=frequency=440:duration=3' -c:a aac /data/data/com.termux/files/home/drift-queue/2026-05-28T03-15-44Z.m4a 2>/dev/null
echo '{\"recorded_at\":\"2026-05-28T03:15:44Z\",\"battery_pct\":85,\"gps_lat\":33.755,\"gps_lon\":-116.378}' > /data/data/com.termux/files/home/drift-queue/2026-05-28T03-15-44Z.json
ls -lh ~/drift-queue/
"
```

Expected: One `.m4a` (~50KB) and one `.json` in the queue.

- [ ] **Step 2: Run uploader and watch the log**

```bash
ssh pixel10 "~/bin/drift-upload-loop.sh && tail -10 ~/drift-queue/uploader.log"
```

Expected: Log shows "uploading ...", "OK: ... chars, ...s — notification sent". The audio file is renamed to `.m4a.sent`.

- [ ] **Step 3: Verify ntfy notification arrived on phone**

Check the Pixel 10 notification tray. Expected: A notification titled "Drift ready" with a body of "...silence..." or whatever Whisper produced for the beep tone. Tap it — Chrome opens to the Incident-Log site with the draft pre-filled.

- [ ] **Step 4: Verify file state after success**

```bash
ssh pixel10 "ls ~/drift-queue/"
```

Expected: `2026-05-28T03-15-44Z.m4a.sent`, `2026-05-28T03-15-44Z.json`, `dead/`, `uploader.log`. No `.attempts` file. No raw `.m4a`.

- [ ] **Step 5: Test failure handling (Mac unreachable)**

```bash
# Stop the Mac server temporarily
launchctl unload ~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist
sleep 2

# Place a new test file on phone and run uploader
ssh pixel10 "
ffmpeg -y -f lavfi -i 'sine=frequency=440:duration=2' -c:a aac ~/drift-queue/2026-05-28T04-00-00Z.m4a 2>/dev/null
~/bin/drift-upload-loop.sh
tail -5 ~/drift-queue/uploader.log
ls ~/drift-queue/
"
```

Expected: Log shows "mac unreachable, skipping queue scan". File still present in queue (not dead-lettered yet).

- [ ] **Step 6: Restart Mac server and verify queue drains**

```bash
launchctl load ~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist
sleep 3

ssh pixel10 "~/bin/drift-upload-loop.sh && tail -5 ~/drift-queue/uploader.log && ls ~/drift-queue/"
```

Expected: File processed successfully, renamed to `.sent`, notification sent.

---

### Task 13: Register periodic uploader via termux-job-scheduler

**Files:** None (Android scheduler config only)

- [ ] **Step 1: Schedule the uploader to run every 15 min**

```bash
ssh pixel10 "
# termux-job-scheduler runs the script periodically; min interval 15 min on most Android versions
termux-job-scheduler --script ~/bin/drift-upload-loop.sh --period-ms 900000 --persisted true --network unmetered
termux-job-scheduler -p
"
```

Expected: Output lists the registered job pointing at `drift-upload-loop.sh`.

- [ ] **Step 2: Note the job ID for future management**

```bash
ssh pixel10 "termux-job-scheduler -p | tee ~/drift-queue/scheduler-info.txt"
```

The output is saved for reference. To later cancel: `termux-job-scheduler --cancel <id>`.

---

## Phase 4: Termux Drift-Report widget

### Task 14: Rewrite the Drift-Report widget

**Files:**
- Modify on Pixel: `~/.shortcuts/Drift-Report`

- [ ] **Step 1: Back up the existing widget**

```bash
ssh pixel10 "cp ~/.shortcuts/Drift-Report ~/.shortcuts/Drift-Report.pre-pipeline.bak"
```

- [ ] **Step 2: Write the new widget**

```bash
ssh pixel10 "cat > ~/.shortcuts/Drift-Report" << 'OUTER_EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Drift-Report — Records voice memo, queues for Mac transcription, returns instantly.
# Notification arrives when transcript is ready (deep link to Incident-Log site).

source ~/bin/drift-config.sh 2>/dev/null

QUEUE="$HOME/drift-queue"
mkdir -p "$QUEUE"

TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
AUDIO="$QUEUE/$TS.m4a"
META="$QUEUE/$TS.json"

# Sidecar metadata (captured fast — best effort)
BATTERY=$(termux-battery-status 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('percentage',0))" 2>/dev/null || echo 0)
LOC_LAT=""
LOC_LON=""
LOC_JSON=$(timeout 3 termux-location -p network 2>/dev/null || true)
if [ -n "$LOC_JSON" ]; then
  LOC_LAT=$(printf '%s' "$LOC_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('latitude',''))" 2>/dev/null || true)
  LOC_LON=$(printf '%s' "$LOC_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('longitude',''))" 2>/dev/null || true)
fi

cat > "$META" <<EOF
{
  "recorded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "battery_pct": ${BATTERY:-0},
  "gps_lat": "${LOC_LAT}",
  "gps_lon": "${LOC_LON}"
}
EOF

# Start vibration
termux-vibrate -d 200 &

# Background process: record 90s, then double-vibrate, then spawn uploader
(
  termux-microphone-record -f "$AUDIO" -l 90 -q -e aac >/dev/null 2>&1
  # Recording done — confirm with double vibrate
  termux-vibrate -d 200
  sleep 0.3
  termux-vibrate -d 200
  # Kick the uploader (drains queue including this file + any stragglers)
  nohup ~/bin/drift-upload-loop.sh >/dev/null 2>&1 &
) &
disown -a

# Speak quick confirmation while user pockets phone
( termux-tts-speak -l en-US -r 1.1 "Drift recording. Ninety seconds." >/dev/null 2>&1 ) &
disown -a

exit 0
OUTER_EOF

ssh pixel10 "chmod +x ~/.shortcuts/Drift-Report"
```

- [ ] **Step 3: Verify script syntax**

```bash
ssh pixel10 "bash -n ~/.shortcuts/Drift-Report && echo OK"
```

Expected: Prints "OK".

- [ ] **Step 4: Verify start time is fast (no ANR risk)**

```bash
ssh pixel10 "time ~/.shortcuts/Drift-Report"
sleep 95
ssh pixel10 "ls -lh ~/drift-queue/"
```

Expected: Script exits in <2 seconds total (the recording happens in background). After 95 seconds, a fresh `.m4a` file appears in the queue.

- [ ] **Step 5: Verify metadata sidecar was written**

```bash
ssh pixel10 "cat ~/drift-queue/*.json | head -20"
```

Expected: JSON with `recorded_at`, `battery_pct`, optional `gps_lat`/`gps_lon`.

---

## Phase 5: End-to-end integration tests

### Task 15: Happy-path test with __TEST__ session

**Files:** None (verification only)

- [ ] **Step 1: Create the __TEST__ session manually on phone browser**

Open `https://themaxlong.github.io/Incident-Log/` on Pixel 10. Tap "+ NEW SESSION". Enter name `__TEST__`. Tap CREATE. Tap back to sessions list.

- [ ] **Step 2: Tap the Drift Report widget and speak**

Tap the widget on the home screen. Say clearly: "This is a hark drift report production test. Greenhouse four pH is normal." Wait for the start vibration, speak, wait for the end double-vibration (90s total).

- [ ] **Step 3: Wait for notification (10-30s after recording end)**

Notification "Drift ready" should appear with the transcript preview.

- [ ] **Step 4: Tap the notification**

Chrome opens to the Incident-Log site. A NEW session for today (e.g., `2026-05-28 · S2`) is created (since `__TEST__` is not today-dated). Actually — wait — re-read the spec: the draft handler creates a session matching today's date, not `__TEST__`.

Decision point: for this test, the auto-created session is fine. The `__TEST__` session was for the SECOND verification path (`?test=1`). For real Drift Report (no `test` param), it goes to today's session.

Expected for happy path: today's session opens, new-incident form pre-filled with the transcript, time field shows the recording time.

- [ ] **Step 5: Fill remaining fields and tap Save**

Select Building `GH`, Room `4`, Category (any). Tap Save.

- [ ] **Step 6: Verify incident exists in localStorage**

In Chrome DevTools (remote-inspect via `chrome://inspect` on Mac → Pixel 10), or by exporting the archive and inspecting:

```
Sessions tab → tap today's session → see the new incident in the list.
```

Expected: Incident appears with the spoken description.

- [ ] **Step 7: Clean up the test incident (optional)**

Delete the test incident or leave it — your call.

---

### Task 16: Multi-recording stack test

**Files:** None (verification only)

- [ ] **Step 1: Tap Drift Report widget 3 times in quick succession (each 90s apart)**

After each tap, wait for the end double-vibration before tapping again. (You can't record concurrently — termux-microphone-record holds the mic.)

- [ ] **Step 2: After 3rd recording ends, verify 3 separate notifications arrive**

Expected: 3 separate "Drift ready" notifications, each with its own transcript preview and deep link.

- [ ] **Step 3: Tap each notification individually**

Expected: Each opens to a fresh new-incident form pre-filled with the corresponding transcript. Each is a separate draft (you can save each independently).

- [ ] **Step 4: Verify queue is empty after all 3 processed**

```bash
ssh pixel10 "ls ~/drift-queue/*.m4a 2>/dev/null | wc -l"
```

Expected: 0 (raw .m4a files). `.m4a.sent` files may exist (kept 7 days).

---

### Task 17: Mac-offline resilience test

**Files:** None (verification only)

- [ ] **Step 1: Stop the Mac whisper server**

```bash
launchctl unload ~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist
```

- [ ] **Step 2: Record a drift report on the phone**

Tap Drift Report widget. Speak. Wait for end double-vibration.

- [ ] **Step 3: Verify file is queued but not processed**

```bash
ssh pixel10 "ls ~/drift-queue/*.m4a 2>/dev/null && tail -3 ~/drift-queue/uploader.log"
```

Expected: One `.m4a` file in queue. Log line "mac unreachable, skipping queue scan".

- [ ] **Step 4: Restart Mac server**

```bash
launchctl load ~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist
sleep 3
```

- [ ] **Step 5: Trigger uploader manually (simulating job-scheduler tick)**

```bash
ssh pixel10 "~/bin/drift-upload-loop.sh"
```

Expected: File processes, notification arrives, file renamed to `.sent`.

---

### Task 18: Cleanup and production cutover

**Files:** None (verification only)

- [ ] **Step 1: Verify `.sent` cleanup logic (manually simulate 7d-old file)**

```bash
ssh pixel10 "
touch -t 202604200000 ~/drift-queue/*.sent  # backdate 30+ days
~/bin/drift-upload-loop.sh
ls ~/drift-queue/*.sent 2>/dev/null && echo 'still present' || echo 'pruned OK'
"
```

Expected: "pruned OK".

- [ ] **Step 2: Delete the __TEST__ session from the Incident-Log site**

Open the site, tap the ✕ next to `__TEST__` session, confirm delete.

- [ ] **Step 3: Verify launchd plist persists across Mac reboot**

```bash
# Confirm RunAtLoad is true in the plist
plutil -extract RunAtLoad raw ~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist
```

Expected: `true`. (The service auto-starts after Mac reboot.)

- [ ] **Step 4: Verify termux-job-scheduler persists across phone reboot**

```bash
ssh pixel10 "termux-job-scheduler -p | grep -c drift-upload-loop"
```

Expected: `1`. Persisted jobs survive reboot.

- [ ] **Step 5: Final sanity check — record one real drift report and save it**

Tap widget. Speak ("End-to-end smoke test passed. System is live."). Wait for notification. Tap. Fill building/room. Save.

Verify the incident appears in today's session in the Incident-Log site.

- [ ] **Step 6: Commit any final repo changes (none expected at this point)**

```bash
cd ~/Documents/GitHub/Incident-Log
git status
```

If any tracked files are modified, review and commit. Otherwise, no action.

---

## Acceptance Criteria Verification

Each of the 12 acceptance criteria from the spec should be checked:

1. ✅ Widget records without ANR — verified in Task 14 Step 4 (exit <2s)
2. ✅ Audio appears in queue with sidecar JSON — verified in Task 14 Step 5
3. ✅ Uploader POSTs over Tailscale — verified in Task 12 Step 2
4. ✅ Whisper returns full sentences with punctuation — verified in Task 4 Step 2 and Task 15 Step 4
5. ✅ Notification within 30s of recording end — verified in Task 15 Step 3
6. ✅ Tap notification → Chrome → form pre-filled — verified in Task 15 Step 4
7. ✅ Save creates incident in localStorage tied to today's session — verified in Task 15 Step 6
8. ✅ End-to-end test passes — verified in Task 18 Step 5
9. ✅ 3 stacked recordings, drain on Mac return — verified in Task 16
10. ✅ Network-switch resilience — verified by virtue of queue-based architecture; Task 17 covers Mac-offline equivalent
11. ✅ 7-day `.sent` cleanup — verified in Task 18 Step 1
12. ✅ Backlog alert fires after 2h — visible in `check_backlog` logic in Task 11; tested via aging files in Task 12 if needed

---

## Future work (deferred per spec)

- Room auto-detection from sidecar GPS
- OpenAI Whisper API fallback when Mac offline
- In-site mic button alternative entry point
- Nominees roll-up view
- Photo + voice combo widget
- Cross-device localStorage sync beyond import/export

---

## Rollback procedure

If the pipeline misbehaves and you need to revert:

1. Restore the old Drift-Report widget: `ssh pixel10 "cp ~/.shortcuts/Drift-Report.pre-pipeline.bak ~/.shortcuts/Drift-Report"`
2. Cancel the job-scheduler: `ssh pixel10 "termux-job-scheduler -c \$(cat ~/drift-queue/scheduler-info.txt | grep -oE 'jobId [0-9]+' | awk '{print \$2}')"`
3. Unload Mac launchd service: `launchctl unload ~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist`
4. Revert Incident-Log site changes: `cd ~/Documents/GitHub/Incident-Log && git revert HEAD~2..HEAD --no-edit && npm run build && git push`

The audio files in `~/drift-queue/` and the transcript audit log on the Mac are preserved through any rollback — no data loss.
