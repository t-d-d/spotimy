# Logging
Relevance: A log line, its level, its fields or its event name, or a new function: service/** emissions, the logger module, serverless.yml function definitions
Decision: Levels mean routing (error = alert, warn = review later, info = as designed); every line names an event; no music or token is logged.

Why: Levels chosen by feel drift until the error alarm means nothing,
and a person's library and Spotify tokens are private.

## Rules

- Every function logs JSON.
- Three levels, no debug. error = someone is alerted now. warn =
  handled but suspect. info = as designed, expected refusals included.
- Every line names an event from the one exported list in
  service/src/log.ts.
- No album, artist, playlist or track name, no Spotify token, cookie or
  code in any line. Ids, counts and statuses only.
- Log a dependency's error class and status, never its message.
- The shared logger is the only way to log.

## Do not

- Log content and scrub it afterwards.
- Log an expected refusal at warn or error.
- Add a debug level.

Judgment: Whether a line is error or warn is a judgement no check can
make.
History: Set when the repo was made, October 2026, following askme-mcp.
