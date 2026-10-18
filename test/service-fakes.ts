// The stand-ins the service talks to in the integration tier. Each test
// file gets its own, started when the file first imports this module.
import { startFakeLambda, startFakeParameters } from "./fake-aws.ts";
import { startFakeSpotify } from "./fake-spotify.ts";

export const publicUrl = "http://127.0.0.1:4999";
export const sessionKeyParameter = "/spotimy/session-key";
export const clientId = "testclient1234";

export const spotify = await startFakeSpotify();
export const parameters = await startFakeParameters();
export const lambda = await startFakeLambda();

parameters.values.set(
  sessionKeyParameter,
  "a-test-key-that-is-long-enough-to-sign-with",
);
