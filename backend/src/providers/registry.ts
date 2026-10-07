import { notFound, notImplemented, upstream } from '../lib/errors';
import { serviceClient, type DbClient } from '../lib/supabase';
import type { FootballDataProvider } from './provider';

export interface DataSourceRow {
  id: string;
  name: string;
  provider: string;
  api_version: string | null;
  is_active: boolean;
  priority: number;
}

export interface ProviderRegistration {
  /** Must match data_sources.provider. */
  name: string;
  version?: string;
  priority: number;
  enabled: boolean;
  createAdapter: () => FootballDataProvider;
}

const runtime = new Map<string, ProviderRegistration>();

export function registerProvider(registration: ProviderRegistration): void {
  runtime.set(registration.name, registration);
}

export function unregisterProvider(name: string): void {
  runtime.delete(name);
}

export function listRegistrations(): ProviderRegistration[] {
  return [...runtime.values()];
}

export function getRegistration(provider: string): ProviderRegistration | null {
  return runtime.get(provider) ?? null;
}

export async function getDataSource(
  client: DbClient,
  ref: { id?: string; provider?: string },
): Promise<DataSourceRow> {
  let query = client
    .from('data_sources')
    .select('id,name,provider,api_version,is_active,priority');
  query = ref.id ? query.eq('id', ref.id) : query.eq('provider', ref.provider as string);
  const { data, error } = await query.maybeSingle();
  if (error) throw upstream('Data source lookup failed');
  if (!data) throw notFound('Data source');
  return data as DataSourceRow;
}

/** Resolve the runtime adapter for a data source row. Throws 501 when absent. */
export async function adapterForDataSource(dataSource: DataSourceRow): Promise<FootballDataProvider> {
  const registration = runtime.get(dataSource.provider);
  if (!registration || !registration.enabled) {
    throw notImplemented(`No runtime adapter registered for provider '${dataSource.provider}'`);
  }
  return registration.createAdapter();
}

/** All data sources are read with the privileged client — never expose rows. */
export async function listDataSources(): Promise<DataSourceRow[]> {
  const { data, error } = await serviceClient()
    .from('data_sources')
    .select('id,name,provider,api_version,is_active,priority')
    .order('priority', { ascending: true });
  if (error) throw upstream('Data source lookup failed');
  return ((data as unknown as DataSourceRow[]) ?? []);
}
