import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../lib/async';
import { unauthorized } from '../lib/errors';
import { anonClient } from '../lib/supabase';

export interface AuthUser {
  id: string;
  email?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

type TokenVerifier = (token: string) => Promise<AuthUser | null>;

async function defaultVerifier(token: string): Promise<AuthUser | null> {
  const { data, error } = await anonClient().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}

let verifyToken: TokenVerifier = defaultVerifier;

/** Test seam: stub Supabase JWT verification. */
export function setTokenVerifier(verifier: TokenVerifier): void {
  verifyToken = verifier;
}

export function resetTokenVerifier(): void {
  verifyToken = defaultVerifier;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [scheme, token] = parts;
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * Authenticate via Supabase JWT. Never trusts client-supplied user_id
 * or role claims — identity comes only from token verification.
 */
export function authenticate(options: { required: boolean }) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) {
      if (options.required) throw unauthorized();
      next();
      return;
    }
    const user = await verifyToken(token);
    if (!user) throw unauthorized('Invalid or expired token');
    req.user = user;
    next();
  });
}
