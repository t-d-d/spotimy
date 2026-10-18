// Signed cookies: the session, and the sign-in in progress (identity.md).
import { errors, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { userIdSchema, type UserId } from "./ids";

export const sessionCookie = "__Host-session";
export const loginCookie = "__Host-login";

export const sessionSeconds = 30 * 24 * 60 * 60;
export const loginSeconds = 10 * 60;

const issuer = "spotimy";

const sessionClaims = z.object({
  use: z.literal("session"),
  sub: userIdSchema,
});

const loginClaims = z.object({
  use: z.literal("login"),
  state: z.string().min(16),
  verifier: z.string().min(43).max(128),
});

export interface Login {
  state: string;
  verifier: string;
}

export interface Sessions {
  signSession: (userId: UserId) => Promise<string>;
  verifySession: (token: string | undefined) => Promise<UserId | undefined>;
  signLogin: (login: Login) => Promise<string>;
  verifyLogin: (token: string | undefined) => Promise<Login | undefined>;
}

export function createSessions(config: {
  key: () => Promise<string>;
  now: () => Date;
}): Sessions {
  const secret = async () => new TextEncoder().encode(await config.key());
  const seconds = () => Math.floor(config.now().getTime() / 1000);

  const sign = async (claims: Record<string, string>, lifetime: number) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setIssuedAt(seconds())
      .setExpirationTime(seconds() + lifetime)
      .sign(await secret());

  const verify = async <T>(
    token: string | undefined,
    schema: z.ZodType<T>,
  ): Promise<T | undefined> => {
    if (token === undefined || token === "") return undefined;
    try {
      const { payload } = await jwtVerify(token, await secret(), {
        issuer,
        algorithms: ["HS256"],
        currentDate: config.now(),
      });
      const parsed = schema.safeParse(payload);
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      // A token that fails its checks is the caller's; anything else, such
      // as the key being out of reach, is the service's fault.
      if (error instanceof errors.JOSEError) return undefined;
      throw error;
    }
  };

  return {
    signSession: (userId) =>
      sign({ use: "session", sub: userId }, sessionSeconds),
    verifySession: async (token) => (await verify(token, sessionClaims))?.sub,
    signLogin: (login) => sign({ use: "login", ...login }, loginSeconds),
    verifyLogin: async (token) => {
      const claims = await verify(token, loginClaims);
      return claims === undefined
        ? undefined
        : { state: claims.state, verifier: claims.verifier };
    },
  };
}

// __Host- cookies must be Secure, on Path=/ and name no domain.
export function setCookie(
  name: string,
  value: string,
  seconds: number,
): string {
  return `${name}=${value}; Max-Age=${String(seconds)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return setCookie(name, "", 0);
}
