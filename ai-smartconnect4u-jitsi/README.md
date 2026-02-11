# ai-smartconnect4u-jitsi

Azure Functions (Python) app for Jitsi meeting creation, audio ingestion, AI transcription/summary, and task extraction. This app lives alongside the existing `ai-receptionist-func` and uses Azure Storage tables/blobs/queues plus OpenAI.

## Structure
- `function_app.py` — Functions host entry point (new programming model).
- `meetings_endpoints.py` — HTTP triggers for meetings CRUD-ish, audio upload, artifacts, re-summarize, tasks.
- `process_meeting_audio.py` — Queue-trigger worker to transcribe + summarize audio.
- `shared_code/` — helpers for storage, OpenAI, auth context, and CORS.
- `host.json` — functions host config.
- `local.settings.json` — template only (no secrets).
- `requirements.txt` — Python deps.

## Run locally
```bash
cd ai-smartconnect4u-jitsi
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# ensure Azure Storage emulator or a real connection string is set
func start --port 7072
```

## Required environment values
- `AzureWebJobsStorage` / `AZURE_STORAGE_CONNECTION_STRING` — storage account for blobs/queues/tables.
- `TEMP_AUDIO_CONTAINER` — blob container for raw uploads (e.g., `meeting-audio-temp`).
- `PROCESSING_QUEUE_NAME` — queue name for audio jobs.
- `OPENAI_API_KEY`
- `OPENAI_MODEL_TRANSCRIBE` (optional, default `whisper-1`)
- `OPENAI_MODEL_SUMMARIZE` (optional, default `gpt-4o-mini`)
- CORS: `CORS` / `ALLOWED_ORIGINS` / `CORS_ALLOW_CREDENTIALS` follow the existing pattern.

## Frontend integration
Add a Jitsi API base env var following the existing pattern:
- Vite/dev: `VITE_JITSI_API_BASE=http://localhost:7072/api`
- Next.js-compatible: `NEXT_PUBLIC_JITSI_API_BASE=https://<prod-ai-smartconnect4u-jitsi-host>/api`

Point meeting-related requests to the new base and use the routes exposed in `meetings_endpoints.py`.

## Meetings + AI Summary
- Tables: `Meetings` (PartitionKey = tenantId, RowKey = meetingId), `MeetingArtifacts`.
- Queue: `PROCESSING_QUEUE_NAME` for audio processing; Blob container `TEMP_AUDIO_CONTAINER` for uploads; transcripts may spill to `MEETING_ARTIFACTS_CONTAINER`.
- Endpoints:
  - POST `/api/meetings` create (status=created, jitsiRoomName hashed from tenant+meeting)
  - GET `/api/meetings` list (tenant-scoped, newest first)
  - GET `/api/meetings/{id}` metadata (publicJoin allows limited unauth)
  - POST `/api/meetings/{id}/audio` upload audio (multipart/raw) -> enqueue job, status=processing
  - GET `/api/meetings/{id}/artifacts` transcript/summary/tasks when ready (202 while processing)
  - POST `/api/meetings/{id}/summarize` re-summarize stored transcript
  - POST `/api/meetings/{id}/tasks` persist edited tasksJson
- Queue worker `ProcessMeetingAudio`:
  - downloads temp audio, transcribes via OpenAI, summarizes to strict JSON schema, writes artifacts, sets status=ready, deletes blob; on error sets status=failed and deletes blob.

## Deployment
Deploy this folder as a separate Functions app (distinct from `ai-receptionist-func`). Ensure the storage account and OpenAI key are configured, and the processing queue/container exist. A separate pipeline/slot can deploy this app without impacting the existing one.
