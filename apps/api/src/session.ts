import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export const SESSION_COOKIE_NAME = '__session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

const sessionPayloadSchema = z.object({
  username: z.string().min(1),
  displayName: z.string().min(1),
  roles: z.array(z.string()),
  clientSlug: z.string().nullable(),
  iat: z.number(),
  exp: z.number(),
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production.');
  }

  return 'dev-only-change-me';
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

export function createSessionToken(payload: Omit<SessionPayload, 'iat' | 'exp'>) {
  const now = Math.floor(Date.now() / 1000);
  const sessionPayload: SessionPayload = {
    ...payload,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };

  const encodedPayload = base64url(JSON.stringify(sessionPayload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySessionToken(token?: string): SessionPayload | null {
  if (!token) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = sign(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = sessionPayloadSchema.parse(JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')));
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSessionCookie(reply: FastifyReply, _request: FastifyRequest, token: string) {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply, _request: FastifyRequest) {
  // Clear current host cookie and the previous broad-domain cookie, if present.
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/', domain: '.idoxs.app' });
  reply.clearCookie('idoxs_session', { path: '/' });
  reply.clearCookie('idoxs_session', { path: '/', domain: '.idoxs.app' });
}

export function getSessionFromRequest(request: FastifyRequest) {
  return verifySessionToken(request.cookies?.[SESSION_COOKIE_NAME]);
}


export function getSessionCookieDiagnostics(request: FastifyRequest) {
  const token = request.cookies?.[SESSION_COOKIE_NAME];
  const session = verifySessionToken(token);
  return {
    cookiePresent: Boolean(token),
    cookieLength: token?.length ?? 0,
    tokenValid: Boolean(session),
    clientSlug: session?.clientSlug ?? null,
    usernamePresent: Boolean(session?.username),
  };
}
