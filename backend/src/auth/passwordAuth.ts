/**
 * Step 16 — Password authentication against the existing Supabase Auth.
 *
 * No new identity system: credentials are verified by Supabase
 * (signInWithPassword / signOut); this backend only proxies the exchange
 * and never stores passwords, hashes, or sessions. The seams below let
 * tests stub the network boundary.
 */
import { anonClient, serviceClient } from '../lib/supabase';

export interface PasswordSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email?: string };
}

type SignIn = (email: string, password: string) => Promise<PasswordSession>;
type SignOut = (accessToken?: string, refreshToken?: string) => Promise<void>;

async function defaultSignIn(email: string, password: string): Promise<PasswordSession> {
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) throw new Error('Invalid email or password');
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresIn: data.session.expires_in ?? 3600,
    user: { id: data.user.id, email: data.user.email ?? undefined },
  };
}

async function defaultSignOut(accessToken?: string, refreshToken?: string): Promise<void> {
  // Best-effort server-side invalidation; cookie clearing happens in the caller.
  try {
    if (refreshToken) {
      await serviceClient().auth.admin.signOut(refreshToken, 'global');
      return;
    }
    if (accessToken) {
      const { createClient } = await import('@supabase/supabase-js');
      const { config } = await import('../config');
      const scoped = createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      await scoped.auth.signOut();
    }
  } catch {
    // Logout must always succeed locally even if the upstream call fails.
  }
}

let signInProvider: SignIn = defaultSignIn;
let signOutProvider: SignOut = defaultSignOut;

/** Test seams (no network in unit tests). */
export function setPasswordAuthProviders(providers: { signIn?: SignIn; signOut?: SignOut }): void {
  if (providers.signIn) signInProvider = providers.signIn;
  if (providers.signOut) signOutProvider = providers.signOut;
}

export function resetPasswordAuthProviders(): void {
  signInProvider = defaultSignIn;
  signOutProvider = defaultSignOut;
}

export function passwordSignIn(email: string, password: string): Promise<PasswordSession> {
  return signInProvider(email, password);
}

export function passwordSignOut(accessToken?: string, refreshToken?: string): Promise<void> {
  return signOutProvider(accessToken, refreshToken);
}
