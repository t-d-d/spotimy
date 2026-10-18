# Hosting
Relevance: Where anything runs or is stored, or a new cloud resource, runtime or front-end framework: serverless.yml, infra/**, web/** build config, service/** entry points
Decision: AWS only: a static React page on S3 and CloudFront, the API and the sync worker on Lambda, data in one DynamoDB table.

Why: A handful of people use spotimy, a few times a day. Everything
must cost nothing while idle, and deploy from GitHub Actions with
short-lived credentials.

## Rules

- One AWS account, holding spotimy alone, in us-east-1. One environment.
- The page is static files, served from S3 through CloudFront. The API
  sits behind the same CloudFront address under /api/, so the page and
  the API share an origin and need no CORS.
- The API is short request-and-response Lambda handlers.
- Syncing runs in the worker function, never in a request. A request
  that starts a sync invokes the worker asynchronously and returns.
- The worker runs once a day on an EventBridge schedule, and when a
  person asks. A run that will not finish inside the function's time
  limit saves its progress and invokes the worker again to carry on.
- DynamoDB is on demand. Every resource scales to zero.
- Secrets live in Parameter Store as SecureStrings and are read at run
  time, never put in the deployment definition or a function's settings.

## Do not

- Add a queue, a container, a provisioned table or anything else with a
  fixed monthly cost: nothing here needs one.
- Sync inside an API request: a first sync takes minutes.
- Use Secrets Manager: it costs money per secret per month, and
  Parameter Store does the job for free.
- Add a second hosting or database provider.

History: Set when the repo was made, October 2026, following askme-mcp.
