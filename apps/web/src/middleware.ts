import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_TOKEN_COOKIE, Permission } from '@vpsy/contracts';

/**
 * Server-side auth boundary for the (portal) app (doc
 * 11-frontend-architecture.md §9 — "the client never holds the authorization
 * decision ... UI is not the security boundary"). This runs before any portal
 * page renders: it verifies the httpOnly session cookie's JWT signature +
 * expiry and redirects an unauthenticated visitor to /login before a single
 * byte of a clinical page reaches the browser — replacing the old
 * client-only `useEffect` redirect in (portal)/layout.tsx as the actual
 * boundary (that client check may stay as a secondary belt-and-braces UX
 * nicety, but it is no longer what's relied on).
 *
 * The per-route-group permission check below is a defense-in-depth UX layer
 * only — it mirrors the same @vpsy/contracts ROLE_PERMISSIONS grants the API
 * enforces, so an authenticated-but-unentitled visitor is bounced to their
 * own landing space instead of rendering a page whose data calls will 403
 * anyway. The NestJS API (JwtAuthGuard + PermissionsGuard + ABAC) remains the
 * sole source of truth for every actual data access — never this file.
 *
 * Ops note: JWT_ACCESS_SECRET must also be set in the web app's server
 * environment (same value as the API). This file verifies the HS256
 * signature itself via the Edge-runtime Web Crypto API rather than adding a
 * JWT-library dependency to apps/web (out of scope for this pass).
 */

/** Route-group prefix → any-of permission required to enter it. Routes not
 * listed here (e.g. /home) only require a valid session, no specific grant. */
const ROUTE_REQUIREMENTS: Array<{ prefix: string; anyOf: string[] }> = [
  { prefix: '/session', anyOf: [Permission.SESSION_HOST] },
  { prefix: '/manager', anyOf: [Permission.ASSIGNMENT_APPROVE] },
  { prefix: '/reports', anyOf: [Permission.REPORTS_READ] },
  { prefix: '/finance', anyOf: [Permission.FINANCE_READ, Permission.FINANCE_MANAGE] },
  { prefix: '/risk', anyOf: [Permission.RISK_READ] },
  { prefix: '/crm', anyOf: [Permission.CRM_READ] },
  { prefix: '/comms', anyOf: [Permission.COMMS_READ] },
  { prefix: '/schedule', anyOf: [Permission.SCHEDULING_READ] },
  { prefix: '/intake', anyOf: [Permission.INTAKE_SUBMIT, Permission.INTAKE_READ] },
  // Closing web wave: Messaging (ctx 14), Telehealth (ctx 12), Admin (ctx 2/27
  // + registries 3/4), CAT assessments — mirrors the API's controller guards.
  { prefix: '/messages', anyOf: [Permission.COMMS_READ] },
  { prefix: '/telehealth', anyOf: [Permission.SCHEDULING_READ] },
  { prefix: '/admin', anyOf: [Permission.ADMIN_CONFIG] },
  { prefix: '/assessments', anyOf: [Permission.ASSESSMENT_ADMINISTER] },
];

interface DecodedAccessToken {
  sub?: string;
  roles?: string[];
  permissions?: string[];
  exp?: number;
}

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const binary = atob(padded);
  // Constructed from an explicit ArrayBuffer (not just a length) so this is
  // typed as Uint8Array<ArrayBuffer> — @types/node's global Uint8Array
  // augmentation otherwise widens `new Uint8Array(n)` to
  // Uint8Array<ArrayBufferLike>, which the DOM lib's BufferSource (used by
  // crypto.subtle.verify below) rejects under strict typechecking.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Verifies an HS256 JWT's signature + expiry using the Web Crypto API
 * (available in the Edge middleware runtime) — no jsonwebtoken/jose
 * dependency needed. Returns the decoded payload only if the signature is
 * valid, `alg` is exactly HS256 (no "none"/alg-confusion), and it isn't
 * expired. */
async function verifyAccessToken(token: string, secret: string): Promise<DecodedAccessToken | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  try {
    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64!)));
    if (header?.alg !== 'HS256') return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signatureB64!),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;

    const payload: DecodedAccessToken = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64!)));
    if (typeof payload.exp === 'number' && Date.now() >= payload.exp * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const secret = process.env.JWT_ACCESS_SECRET;

  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('from', req.nextUrl.pathname);

  if (!token || !secret) {
    return NextResponse.redirect(loginUrl);
  }

  const payload = await verifyAccessToken(token, secret);
  if (!payload) {
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(ACCESS_TOKEN_COOKIE);
    return res;
  }

  const granted = new Set(payload.permissions ?? []);
  const requirement = ROUTE_REQUIREMENTS.find((r) => req.nextUrl.pathname.startsWith(r.prefix));
  if (requirement && !requirement.anyOf.some((p) => granted.has(p))) {
    // Authenticated but not entitled to this route group — send them to
    // their own landing space rather than rendering a page every data call
    // on it would 403 anyway (doc 11 §9 "role switch").
    return NextResponse.redirect(new URL('/home', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/home/:path*',
    '/intake/:path*',
    '/session/:path*',
    '/crm/:path*',
    '/comms/:path*',
    '/risk/:path*',
    '/schedule/:path*',
    '/finance/:path*',
    '/reports/:path*',
    '/manager/:path*',
    '/messages/:path*',
    '/telehealth/:path*',
    '/admin/:path*',
    '/assessments/:path*',
  ],
};
