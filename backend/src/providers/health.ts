import { ProviderHttpError } from './httpClient';
import type { FootballDataProvider } from './provider';
import { getRegistration, type DataSourceRow } from './registry';

export type ProviderHealthStatus =
  | 'configured'
  | 'enabled'
  | 'reachable'
  | 'degraded'
  | 'rate_limited'
  | 'unauthorized'
  | 'unavailable';

export interface ProviderHealth {
  provider: string;
  dataSourceId?: string;
  status: ProviderHealthStatus;
  latencyMs?: number;
  detail?: string;
  checkedAt: string;
}

/** Safe adapter probe. Secrets never appear in the result. */
export async function checkAdapterHealth(
  name: string,
  adapter: FootballDataProvider,
  enabled: boolean,
): Promise<ProviderHealth> {
  const checkedAt = new Date().toISOString();
  if (!enabled) return { provider: name, status: 'configured', checkedAt };
  if (!adapter.ping) return { provider: name, status: 'enabled', checkedAt };
  const startedAt = Date.now();
  try {
    await adapter.ping();
    return { provider: name, status: 'reachable', latencyMs: Date.now() - startedAt, checkedAt };
  } catch (error) {
    if (error instanceof ProviderHttpError) {
      if (error.code === 'AUTH') return { provider: name, status: 'unauthorized', checkedAt };
      if (error.code === 'RATE_LIMITED') return { provider: name, status: 'rate_limited', checkedAt };
      if (error.code === 'TIMEOUT' || error.code === 'NETWORK') {
        return { provider: name, status: 'unavailable', checkedAt };
      }
    }
    return { provider: name, status: 'degraded', checkedAt };
  }
}

export async function checkDataSourceHealth(dataSource: DataSourceRow): Promise<ProviderHealth> {
  const registration = getRegistration(dataSource.provider);
  if (!registration || !registration.enabled || !dataSource.is_active) {
    return {
      provider: dataSource.provider,
      dataSourceId: dataSource.id,
      status: 'unavailable',
      detail: 'No runtime adapter registered',
      checkedAt: new Date().toISOString(),
    };
  }
  const health = await checkAdapterHealth(
    dataSource.provider,
    registration.createAdapter(),
    true,
  );
  return { ...health, dataSourceId: dataSource.id };
}
