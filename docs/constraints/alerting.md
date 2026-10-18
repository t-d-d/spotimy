# Alerting
Relevance: Alarms, metric filters, the alert topic, or a new function: serverless.yml
Decision: Three alarms, all emailing the owner through one topic: error lines, function failures and spend.

Why: Nobody watches the logs. An error line means someone should look
now, and the bill is the last net for a runaway.

## Rules

- Every function has a metric filter counting its error-level lines.
- The error-lines alarm fires on any error line in a minute.
- The function-failures alarm fires on any Lambda error or throttle.
- The spend alarm reads the account's bill against
  /spotimy/alerts/monthly-spend.
- Alerts go to the address in /spotimy/alerts/email.

## Do not

- Alarm on warnings: they are reviewed, not paged.
- Add a paid monitoring service.

History: Set when the repo was made, October 2026, following askme-mcp.
