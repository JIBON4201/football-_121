import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { upstream } from './errors';

export type DbClient = SupabaseClient;

let anonFactory: () => DbClient = () =>
  createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

let serviceFactory: () => DbClient = () => {
  if (!config.supabaseServiceKey) {
    throw upstream('Service unavailable');
  }
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

let anonInstance: DbClient | null = null;
let serviceInstance: DbClient | null = null;

/** Public data access honoring RLS. Safe for unauthenticated requests. */
export function anonClient(): DbClient {
  if (!anonInstance) anonInstance = anonFactory();
  return anonInstance;
}

/**
 * Privileged server-side access (bypasses RLS).
 * NEVER expose this client, its key, or its results to untrusted callers
 * without explicit authorization checks.
 */
export function serviceClient(): DbClient {
  if (!serviceInstance) serviceInstance = serviceFactory();
  return serviceInstance;
}

/** Test seam: swap client factories (e.g. in-memory fakes). */
export function setClientFactories(factories: {
  anon?: () => DbClient;
  service?: () => DbClient;
}): void {
  if (factories.anon) {
    anonFactory = factories.anon;
    anonInstance = null;
  }
  if (factories.service) {
    serviceFactory = factories.service;
    serviceInstance = null;
  }
}

export function resetClients(): void {
  anonInstance = null;
  serviceInstance = null;
}
