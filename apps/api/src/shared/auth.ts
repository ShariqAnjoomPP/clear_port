import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import type { Role } from '@clearport/kernel';
import { config } from '../config';
import type { Actor } from './context';
import { unauthorized } from './problem';

/** Port: verifies an access token and returns the actor. Adapters: local dev issuer, Amazon Cognito. */
export interface TokenVerifier {
  verify(token: string): Promise<Actor>;
}

const devKey = () => new TextEncoder().encode(config.JWT_SECRET);
const ISSUER = 'clearport-dev';

export interface AccessClaims {
  sub: string;
  tid: string;
  name: string;
  email: string;
  roles: Role[];
  cid: string | null;
}

class DevTokenVerifier implements TokenVerifier {
  async verify(token: string): Promise<Actor> {
    try {
      const { payload } = await jwtVerify(token, devKey(), { issuer: ISSUER, audience: 'clearport-api', algorithms: ['HS256'] });
      const p = payload as unknown as AccessClaims & { typ: string };
      if (p.typ !== 'access') throw new Error('wrong token type');
      return { kind: 'user', userId: p.sub, tenantId: p.tid, name: p.name, email: p.email, roles: p.roles, customerId: p.cid ?? null };
    } catch {
      throw unauthorized('Invalid or expired token');
    }
  }
}

class CognitoTokenVerifier implements TokenVerifier {
  private jwks = createRemoteJWKSet(new URL(`https://cognito-idp.${config.COGNITO_REGION}.amazonaws.com/${config.COGNITO_USER_POOL_ID}/.well-known/jwks.json`));
  async verify(token: string): Promise<Actor> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `https://cognito-idp.${config.COGNITO_REGION}.amazonaws.com/${config.COGNITO_USER_POOL_ID}`,
      });
      if (payload.token_use !== 'access' || payload.client_id !== config.COGNITO_CLIENT_ID) throw new Error('wrong token');
      // Tenant, user and customer ids are added by the Cognito pre-token-generation trigger.
      return {
        kind: 'user',
        userId: String(payload['custom:user_id']),
        tenantId: String(payload['custom:tenant_id']),
        name: String(payload['name'] ?? payload['username'] ?? ''),
        roles: (payload['cognito:groups'] as Role[]) ?? [],
        customerId: (payload['custom:customer_id'] as string) || null,
      };
    } catch {
      throw unauthorized('Invalid or expired token');
    }
  }
}

export const tokenVerifier: TokenVerifier = config.AUTH_MODE === 'cognito' ? new CognitoTokenVerifier() : new DevTokenVerifier();

/** Dev token issuer (token-handler pattern): 15-minute access token, 7-day refresh token in an HttpOnly cookie. */
export async function issueDevTokens(c: AccessClaims) {
  const access = await new SignJWT({ ...c, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('clearport-api')
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(devKey());
  const refresh = await new SignJWT({ email: c.email, typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('clearport-auth')
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(devKey());
  return { access, refresh, expiresIn: 900 };
}

export async function verifyDevRefresh(token: string): Promise<{ sub: string; email: string }> {
  try {
    const { payload } = await jwtVerify(token, devKey(), { issuer: ISSUER, audience: 'clearport-auth', algorithms: ['HS256'] });
    if (payload.typ !== 'refresh') throw new Error('wrong type');
    return { sub: String(payload.sub), email: String(payload.email) };
  } catch {
    throw unauthorized('Session expired. Please sign in again.');
  }
}

/** Short-lived signed tokens for local file upload/download URLs (stand-in for S3 presigned URLs). */
export async function signFileToken(claims: Record<string, unknown>, ttlSeconds: number) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuer('clearport-files').setExpirationTime(`${ttlSeconds}s`).sign(devKey());
}
export async function verifyFileToken(token: string) {
  const { payload } = await jwtVerify(token, devKey(), { issuer: 'clearport-files', algorithms: ['HS256'] });
  return payload as Record<string, unknown>;
}

/** Random 256-bit token for driver trip links and customer approvals; only its SHA-256 hash is stored. */
export function newLinkToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString('base64url');
}
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Buffer.from(digest).toString('hex');
}
