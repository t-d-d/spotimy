import { afterAll, beforeEach, vi } from "vitest";
import { forgetServices } from "../service/src/services.ts";
import {
  clientId,
  lambda,
  parameters,
  publicUrl,
  sessionKeyParameter,
  spotify,
} from "./service-fakes.ts";

vi.stubEnv("PUBLIC_URL", publicUrl);
vi.stubEnv("SPOTIFY_CLIENT_ID", clientId);
vi.stubEnv("SESSION_KEY_PARAMETER", sessionKeyParameter);
vi.stubEnv("WORKER_FUNCTION", "spotimy-test-worker");
vi.stubEnv("SPOTIFY_API_BASE", spotify.apiBase);
vi.stubEnv("SPOTIFY_ACCOUNTS_BASE", spotify.accountsBase);
vi.stubEnv("SSM_ENDPOINT", parameters.endpoint);
vi.stubEnv("LAMBDA_ENDPOINT", lambda.endpoint);

// Each test starts with empty fakes, and services made from its own table.
beforeEach(() => {
  spotify.reset();
  lambda.invoked.length = 0;
  forgetServices();
});

afterAll(async () => {
  await Promise.all([spotify.close(), parameters.close(), lambda.close()]);
});
