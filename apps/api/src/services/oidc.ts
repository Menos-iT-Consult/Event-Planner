import { createPublicKey, type JsonWebKey } from "node:crypto";
import jwt, { type JwtHeader, type JwtPayload } from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { hashOpaqueToken } from "../lib/tokens.js";

const discoverySchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
});

const tokenResponseSchema = z.object({
  id_token: z.string().min(1),
});

const jwksSchema = z.object({
  keys: z.array(z.record(z.string(), z.unknown())),
});

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

let discoveryCache: { value: OidcDiscovery; expiresAt: number } | undefined;
let jwksCache: { issuer: string; keys: Array<Record<string, unknown>>; expiresAt: number } | undefined;

export function isOidcConfigured(): boolean {
  return Boolean(config.OIDC_ISSUER && config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET);
}

export function getAllowedOidcEmailDomains(): string[] {
  return (config.OIDC_ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

export function isSafeReturnPath(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : "/dashboard";
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`OIDC provider request failed (${response.status})`);
  return response.json();
}

export async function discoverOidcProvider(): Promise<OidcDiscovery> {
  if (!isOidcConfigured() || !config.OIDC_ISSUER) {
    throw new Error("OIDC sign-in is not configured");
  }
  if (discoveryCache && discoveryCache.expiresAt > Date.now()) return discoveryCache.value;

  const issuer = config.OIDC_ISSUER.replace(/\/+$/, "");
  const discovery = discoverySchema.parse(await fetchJson(`${issuer}/.well-known/openid-configuration`));
  if (discovery.issuer.replace(/\/+$/, "") !== issuer) {
    throw new Error("OIDC discovery issuer does not match OIDC_ISSUER");
  }
  if (config.NODE_ENV === "production" && [
    discovery.authorization_endpoint,
    discovery.token_endpoint,
    discovery.jwks_uri,
  ].some((endpoint) => new URL(endpoint).protocol !== "https:")) {
    throw new Error("OIDC endpoints must use HTTPS in production");
  }
  discoveryCache = { value: discovery, expiresAt: Date.now() + 15 * 60_000 };
  return discovery;
}

async function findSigningKey(issuer: string, jwksUri: string, header: JwtHeader): Promise<JsonWebKey> {
  if (!header.kid || (header.alg !== "RS256" && header.alg !== "ES256")) {
    throw new Error("OIDC ID token uses an unsupported signing key or algorithm");
  }
  if (!jwksCache || jwksCache.issuer !== issuer || jwksCache.expiresAt <= Date.now()) {
    const jwks = jwksSchema.parse(await fetchJson(jwksUri));
    jwksCache = { issuer, keys: jwks.keys, expiresAt: Date.now() + 15 * 60_000 };
  }
  let jwk = jwksCache.keys.find((candidate) =>
    candidate.kid === header.kid && (candidate.alg === undefined || candidate.alg === header.alg),
  );
  if (!jwk) {
    jwksCache = undefined;
    const jwks = jwksSchema.parse(await fetchJson(jwksUri));
    jwksCache = { issuer, keys: jwks.keys, expiresAt: Date.now() + 15 * 60_000 };
    jwk = jwks.keys.find((candidate) =>
      candidate.kid === header.kid && (candidate.alg === undefined || candidate.alg === header.alg),
    );
  }
  if (!jwk) throw new Error("OIDC provider signing key was not found");
  return jwk as JsonWebKey;
}

export async function exchangeOidcCode(input: {
  code: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
}): Promise<JwtPayload> {
  const discovery = await discoverOidcProvider();
  const clientId = config.OIDC_CLIENT_ID!;
  const clientSecret = config.OIDC_CLIENT_SECRET!;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  const rawTokenResponse = await fetchJson(discovery.token_endpoint, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const tokenResponse = tokenResponseSchema.parse(rawTokenResponse);
  const decoded = jwt.decode(tokenResponse.id_token, { complete: true });
  if (!decoded || typeof decoded === "string") throw new Error("OIDC provider returned an invalid ID token");

  const jwk = await findSigningKey(discovery.issuer, discovery.jwks_uri, decoded.header);
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const verified = jwt.verify(tokenResponse.id_token, publicKey, {
    algorithms: [decoded.header.alg as "RS256" | "ES256"],
    issuer: discovery.issuer,
    audience: clientId,
    clockTolerance: 5,
    maxAge: "10m",
  }) as JwtPayload;
  if (
    typeof verified.sub !== "string" ||
    !verified.sub ||
    typeof verified.nonce !== "string" ||
    hashOpaqueToken(verified.nonce) !== input.nonce
  ) {
    throw new Error("OIDC ID token subject or nonce is invalid");
  }
  if (Array.isArray(verified.aud) && verified.aud.length > 1 && verified.azp !== clientId) {
    throw new Error("OIDC ID token authorized party is invalid");
  }
  return verified;
}

