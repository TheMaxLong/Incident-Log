# Drift Report Pipeline — Design Spec

**Date:** 2026-05-28
**Status:** Approved, ready for implementation
**Owner:** Max

## Problem

The existing Pixel 10 Drift Report widget captures voice memos via Termux STT and writes them to a local log file (`~/incident-log/YYYY-MM-DD.log`). The Incident-Log site (`themaxlong.github.io/Incident-Log/`) stores formal incident reports in browser localStorage. The two systems are physically on the same phone but never talk to each other. Every voice memo dies in a log file Max never opens.

Additionally, the current Termux STT produces choppy, unpunctuated transcripts that require heavy manual revision before they can be used as incident descriptions.

## Goal

Build a one-tap voice-to-draft-incident pipeline:

1. Tap the Drift Report widget on the Pixel 10 home screen
2. Speak a stream-of-consciousness observation while walking the facility
3. Audio is transcribed by Whisper (high quality — full sentences, proper punctuation)
4. A notification arrives on the phone when transcription is ready
5. Tapping the notification opens the Incident-Log site with a pre-filled draft incident under tonight's session, with the transcript already in the description field
6. Max fills in building / room / category and taps Save

The pipeline must tolerate network drops (WiFi ↔ 5G), Mac offline states, and multiple recordings stacking up without intervention.

## Non-Goals

- Automatic room detection (deferred — sidecar GPS captured for future use)
- Real-time live transcription as Max speaks
- Cloud-based transcription as primary path (Whisper on Mac is the chosen path; OpenAI API is a possible future fallback)
- Photo capture inside the drift flow (the existing Incident-Log photo upload remains, but Drift Report is voice-only)
- Multi-device sync of localStorage (the existing import/export button continues to handle that)

## Architecture

```
[Pixel 10 Drift Report widget]  ──tap──▶  records to ~/drift-queue/
                                                │
                                       (background upload loop)
                                                │
                                                ▼
                        [Mac whisper.cpp HTTP server on Tailscale]
                                                │
                                       (transcribes ~2-5s)
                                                │
                                                ▼
                                  [ntfy push to your phone]
                                                │
                                          (tap notification)
                                                │
                                                ▼
                  [Chrome opens Incident-Log site with ?draft=<text>]
                                                │
                                                ▼
                  [Site auto-navigates to tonight's session, opens
                   new incident form with description pre-filled]
```

Key property: the upload loop is **decoupled from recording**. Recording always completes (audio file is on disk). The uploader can be retried at any time. Network drops between WiFi and 5G are transparent — the audio file sits in the queue and retries on the next loop tick. Multiple recordings stack as separate files, each gets its own notification when ready.

## Components

### 1. Pixel 10 Drift Report widget

**Path:** `~/.shortcuts/Drift-Report` (rewrite of existing)

**Behavior:**
- Single tap = vibrate once, start recording AAC m4a to `~/drift-queue/<ISO-timestamp>.m4a`
- Fixed 90-second cap (via `termux-microphone-record -l 90`)
- Vibrate at start, double-vibrate at end
- Write sidecar metadata file `~/drift-queue/<ISO-timestamp>.json` with `{recorded_at, battery_pct, gps_lat, gps_lon}` (room auto-detection groundwork — not used in v1)
- Spawn the uploader in background: `nohup ~/bin/drift-upload-loop.sh > /dev/null 2>&1 &`
- Exit in <500ms to avoid Android ANR

**Dependencies:**
- `termux-microphone-record` (Termux:API)
- `termux-vibrate` (Termux:API)
- `termux-location` (Termux:API, optional — fallback to empty values)

### 2. Drift Queue Uploader

**Path:** `~/bin/drift-upload-loop.sh`

**Behavior:**
- Two triggers: (a) spawned at end of each widget tap, (b) `termux-job-scheduler` every 15 min to catch stragglers
- Scan `~/drift-queue/*.m4a` for unsent files (no `.sent` companion)
- For each:
  1. Health-check Mac: `curl -m 2 http://maxs-macbook-air-1.tailf0f27a.ts.net:9090/health` — abort if unreachable
  2. POST audio to Mac: `curl -X POST -H "Authorization: Bearer $TOKEN" -F audio=@<file>.m4a -F metadata=@<file>.json http://maxs-macbook-air-1.tailf0f27a.ts.net:9090/transcribe`
  3. On 200: receive transcript JSON, push ntfy notification with deep link, rename file to `.sent`
  4. On 5xx/timeout: leave in queue, increment retry counter in `.attempts` sidecar file
  5. On 3+ failures: move to `~/drift-queue/dead/`, fire ntfy "Transcription failed" alert
- Prune `.sent` files older than 7 days
- If any file in queue >2 hours old, fire low-priority ntfy "Drift backlog: N pending, Mac unreachable"

**Dependencies:**
- `curl`
- `~/.config/hark/drift-token` containing the bearer token (mode 600)
- `~/bin/drift-config.sh` exporting `MAC_HOST`, `MAC_PORT`, `NTFY_TOPIC`, `INCIDENT_LOG_URL`

### 3. Mac whisper.cpp HTTP server

**Install path:** `~/.local/hark-whisper/` (whisper.cpp clone + small.en model)
**Server path:** `~/.local/hark-whisper/server.py`
**Service:** `~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist`

**Behavior:**
- Python `http.server`-based HTTP service on port 9090
- Bound to Tailscale interface IP only (`100.65.146.120`, NOT `0.0.0.0`) — tailnet-only access
- Bearer token auth on every request (`Authorization: Bearer <token>`)
- Endpoints:
  - `GET /health` → `200 {"ok": true, "model": "small.en"}`
  - `POST /transcribe` (multipart: `audio` file, optional `metadata` JSON):
    - Save uploaded m4a to `/tmp/hark-whisper-<uuid>.m4a`
    - ffmpeg convert to 16kHz mono WAV
    - Run `./main -m models/ggml-small.en.bin -f input.wav --output-txt --no-timestamps -nt`
    - Read output text, return `{"transcript": "...", "duration_sec": N, "model": "small.en"}`
    - Append to `~/Library/Logs/hark-drift-transcripts.log` with timestamp + transcript + metadata
    - Server-side timeout: 30s per request → 504 if exceeded
    - Delete temp files on completion
- launchd config:
  - `KeepAlive` true (auto-restart on crash)
  - `RunAtLoad` true (start on Mac boot/login)
  - Log to `~/Library/Logs/hark-whisper.log`

**Dependencies:**
- `whisper.cpp` (built locally, includes `main` binary)
- `ggml-small.en.bin` model (~487MB, downloaded via `bash ./models/download-ggml-model.sh small.en`)
- `ffmpeg` (already installed or `brew install ffmpeg`)
- Python 3 stdlib only (no third-party packages)

### 4. ntfy notification bridge

**Topic:** `hark-drift-ready-<unguessable-token>` (dedicated, distinct from existing `hark-phones-*` topic)

**Per-transcript notification payload:**
- Title: `Drift ready`
- Body: First 80 chars of transcript + `…` if truncated
- `Click` header: `https://themaxlong.github.io/Incident-Log/?draft=<base64-transcript>&recorded=<iso-timestamp>&dur=<seconds>`
- Priority: default (3)

**Backlog alert payload:**
- Title: `Drift backlog`
- Body: `N pending, Mac unreachable`
- Priority: 2 (low)

**Failure alert payload:**
- Title: `Transcription failed`
- Body: First 80 chars of audio metadata + filename
- Priority: 4 (high)

**Daily summary (optional, 6am):**
- Title: `Drift Report nightly`
- Body: `Last night: N captured, N transcribed, N failed`
- Priority: 2 (low)

### 5. Incident-Log site changes

**Files modified:**
- `src/App.tsx` — read URL params on mount, route to drift handler
- `src/lib/draftHandler.ts` (NEW) — URL param parser + session/incident factory
- `src/pages/IncidentPage.tsx` — accept `initialDraft` prop to pre-fill form on mount

**Behavior:**
- On page load, parse `window.location.search` for `?draft=<base64>&recorded=<iso>&dur=<n>&test=<0|1>`
- If `draft` param present:
  - Decode base64 transcript
  - Find today's session by date match — if none, auto-create with `{date: <today, ISO date>, shift: "S2", name: ""}`
  - Navigate directly to `IncidentPage` for that session
  - Open the "new incident" form with:
    - `description` field pre-filled with transcript (editable)
    - `time` field pre-filled from `recorded` param (HH:MM)
    - All other fields blank
  - **Do NOT auto-save** — incident is only created when user taps Save
  - Show a banner: `📝 Draft from Drift Report — review and save`
- If `test=1`: show a yellow `🧪 TEST MODE` banner instead, and disable the Save button (prevents test data leaking into real shift logs)
- If URL parse fails: log to console, render the normal SessionsPage (no crash, no data loss)

**Session auto-creation rules:**
- "Today" is determined by Pacific Time (browser local time; site is single-user)
- Default shift is `"S2"` (night) — Max's standard
- Session name left blank (user can fill in later)

### Configuration / secrets

| Key | Location | Purpose |
|-----|----------|---------|
| `DRIFT_TOKEN` | `~/.config/hark/drift-token` (phone) + `~/.config/hark/drift-token` (Mac) | Bearer auth between phone and Mac server |
| `NTFY_TOPIC` | `~/bin/drift-config.sh` | Dedicated ntfy topic for Drift-ready pushes |
| `MAC_HOST` | `~/bin/drift-config.sh` | `maxs-macbook-air-1.tailf0f27a.ts.net` |
| `MAC_PORT` | `~/bin/drift-config.sh` | `9090` |
| `INCIDENT_LOG_URL` | `~/bin/drift-config.sh` | `https://themaxlong.github.io/Incident-Log/` |

## Data flow (lifecycle of one drift report)

1. **T+0s** — Widget tap. Phone vibrates. Recording starts.
2. **T+90s** — Recording ends (or earlier if user taps stop). Audio saved to `~/drift-queue/<ts>.m4a`. Sidecar JSON written. Uploader spawned.
3. **T+90.1s** — Uploader scans queue, finds new file, health-checks Mac.
4. **T+91s** — Audio POSTed to Mac whisper server.
5. **T+91s to T+96s** — Mac transcribes (~3-5s on M-series for 90s of audio with small.en model).
6. **T+96s** — Mac returns `{transcript, duration_sec}`. Uploader builds deep link URL, posts to ntfy.
7. **T+96.5s** — ntfy push lands on phone. Notification appears.
8. **T+? (any time later)** — Max taps notification. Chrome opens Incident-Log with URL params.
9. **T+? + 0.5s** — Site parses URL, finds/creates today's session, opens new-incident form pre-filled.
10. **T+? + Ns** — Max fills building/room/category. Taps Save. Incident enters localStorage.
11. **T+96s + 7 days** — Audio file pruned from `~/drift-queue/`. Transcript persists in localStorage + Mac log.

## Error handling

### Network failures (WiFi ↔ 5G switching)
- Mid-upload curl failure: audio file untouched. Uploader retries next pass.
- Tailnet flake: health check fails, queue waits.

### Mac offline (asleep, restarted, network down)
- Uploader scans every 15 min via `termux-job-scheduler`.
- Queue drains when Mac returns.
- After 2 hours pending, low-priority "Drift backlog" alert fires.

### Mic permission denied / recording fails
- 3x rapid vibration + TTS "microphone blocked"
- User knows at point of capture, no silent failure.

### Whisper produces garbage or empty transcript
- Returned as-is. Site opens draft with weird/empty description.
- User discards by closing tab (no save = no clutter).
- Audio remains in `.sent/` for 7 days for manual re-transcription.

### Whisper crashes / hangs
- Server-side 30s timeout → 504.
- 3 retries → move to `~/drift-queue/dead/` + high-priority ntfy alert.

### ntfy outage
- Notification fails silently from user's perspective.
- Backup: Mac log at `~/Library/Logs/hark-drift-transcripts.log` retains every transcript with timestamp.
- Recovery: `ssh maxs-mac "tail ~/Library/Logs/hark-drift-transcripts.log"` to inspect, or run a "resend last 24h" command (`~/bin/drift-resend-recent.sh`).

### URL too long (>2KB)
- Transcript hard-capped at 3000 chars before base64 encoding.
- If hit, append `[...truncated, full audio on Mac...]`.

### Site URL parse failure
- Console error, render normal SessionsPage. No crash.

### localStorage full / browser data cleared
- Same behavior as existing Incident-Log. Drift Report does not change this risk.

### Phone reboots / Termux killed
- `termux-job-scheduler` resumes on next wake.
- Audio files persist on disk.

### Token misconfiguration
- 401 from Mac → uploader logs, audio stays in queue (recoverable, not dead-lettered).
- Surfaces via backlog alert after 2h.

### Daily summary
- 6am ntfy: "Last night: N captured, N transcribed, N failed". Catches silent issues.

## Testing

### Per-component smoke tests

1. **Mac whisper server**
   - From Mac itself: `curl -F audio=@test.m4a -H "Authorization: Bearer $TOKEN" http://localhost:9090/transcribe`
   - From tailnet: same against `maxs-macbook-air-1.tailf0f27a.ts.net:9090`
   - Verify known phrase transcribes correctly with punctuation
   - Verify 401 with wrong token
   - Verify 200 on `/health`

2. **Termux widget**
   - Tap widget → `.m4a` + `.json` appear in `~/drift-queue/`
   - Widget process exits in <500ms
   - Start/end vibration cues fire

3. **Uploader**
   - Manual run with known queued file → POST → 200 → `.sent` rename → ntfy push
   - Kill Mac server, run again → file stays in queue
   - 3 failed attempts → file in `~/drift-queue/dead/`

4. **ntfy delivery**
   - Notification arrives with correct title/body/click URL
   - Tap → Chrome opens correct URL

5. **Site URL handler**
   - Manual visit with `?draft=<b64>&recorded=<iso>&test=1`
   - Verify session auto-creates if absent
   - Verify new-incident form opens with description = decoded text
   - Verify TEST MODE banner + disabled Save button
   - Verify base64 edge cases (newlines, quotes, emoji)

### End-to-end production smoke test

- Real recording → real notification → real save → verify Incident-Log entry exists
- Use a clearly-marked test session `__TEST__` for the smoke test (deletable)
- After verification: delete `__TEST__` session

### Safety: test isolation
- All test recordings carry `test=1` URL param → site shows yellow TEST MODE banner + disables Save
- Production widget never sets `test=1`

### Out of scope
- No unit test framework setup for the React site (URL parser is small enough that smoke covers it)
- No load testing (single user, ~10 reports/shift max)

## Acceptance criteria

The system is considered shipped when:

1. Tapping Drift Report widget on Pixel 10 records audio without ANR
2. Audio appears in `~/drift-queue/` with sidecar JSON
3. Uploader successfully POSTs to Mac whisper server over Tailscale
4. Mac whisper server returns transcript with full sentences and proper punctuation
5. ntfy notification arrives on phone within 30s of recording end (when Mac is online)
6. Tapping notification opens Chrome → Incident-Log site → new-incident form pre-filled
7. Filling building/room/category and tapping Save creates an incident in localStorage tied to today's session
8. End-to-end test with `__TEST__` session passes
9. Killing the Mac server and recording 3 drifts in a row leaves 3 files in queue; bringing Mac back drains all 3 with 3 separate notifications
10. Network switch from WiFi to 5G mid-upload results in successful eventual delivery
11. After 7 days, `.sent` files are pruned automatically
12. Backlog alert fires correctly when files >2h old remain in queue

## Future work (explicit deferrals)

- **Room auto-detection** from GPS metadata (sidecar JSON already captures it)
- **OpenAI Whisper API fallback** when Mac is offline >2h (eliminates the "Mac is asleep" gap)
- **Direct in-site mic button** for when Max is already at his desk (alternative entry point)
- **"Nominees review" view** showing all today's transcripts in a queue before promotion to incidents (currently each notification IS the nominee, but a roll-up view could batch-review)
- **Photo attachment via Drift Report** (record voice + take photo in one widget tap)
- **Cross-device localStorage sync** (currently handled by manual import/export)

## File / path summary

### Pixel 10 (Termux)
- `~/.shortcuts/Drift-Report` — widget script (rewritten)
- `~/bin/drift-upload-loop.sh` — queue uploader
- `~/bin/drift-config.sh` — config exports
- `~/bin/drift-job-scheduler-register.sh` — one-time setup for periodic uploader
- `~/.config/hark/drift-token` — bearer token (mode 600)
- `~/drift-queue/` — audio files + sidecar JSON
- `~/drift-queue/dead/` — failed transcriptions
- `~/drift-queue/uploader.log` — uploader activity log

### Mac
- `~/.local/hark-whisper/` — whisper.cpp install + model
- `~/.local/hark-whisper/server.py` — HTTP server
- `~/.config/hark/drift-token` — bearer token (mode 600)
- `~/Library/LaunchAgents/com.themaxlong.hark.whisper.plist` — service
- `~/Library/Logs/hark-whisper.log` — server log
- `~/Library/Logs/hark-drift-transcripts.log` — every transcript ever (audit trail)

### Incident-Log repo
- `src/App.tsx` — URL param routing
- `src/lib/draftHandler.ts` — new
- `src/pages/IncidentPage.tsx` — accept `initialDraft` prop
- `docs/superpowers/specs/2026-05-28-drift-report-pipeline-design.md` — this doc
