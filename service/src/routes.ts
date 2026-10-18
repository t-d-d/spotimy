// Every route API Gateway sends here. serverless.yml lists the same ones,
// and a static test holds the two lists together.
export const routes = [
  "GET /api/login",
  "GET /api/callback",
  "POST /api/logout",
  "GET /api/status",
  "PUT /api/settings",
  "POST /api/check",
  "POST /api/apply",
  "POST /api/leave",
] as const;

export type Route = (typeof routes)[number];

const known = new Set<string>(routes);

export const isRoute = (route: string): route is Route => known.has(route);
