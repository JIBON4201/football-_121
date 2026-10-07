import { z } from 'zod';
import { badRequest, conflict, notFound, upstream } from '../lib/errors';
import { serviceClient, type DbClient } from '../lib/supabase';
import { IMPORT_ORDER } from '../providers/importService';
import type { SyncEntityType } from '../providers/types';

const entityEnum = z.enum([...IMPORT_ORDER] as [SyncEntityType, ...SyncEntityType[]]);

export interface ScheduleRow {
  id: string;
  name: string;
  provider: string;
  entity_type: string;
  scope: { entities?: SyncEntityType[]; params?: Record<string, string | number | boolean>; limit?: number; batchSize?: number };
  frequency_seconds: number;
  enabled: boolean;
  priority: number;
  max_attempts: number;
  last_run_at: string | null;
  next_run_at: string;
  last_job_id: string | null;
  last_status: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

const scopeSchema = z
  .object({
    entities: z.array(entityEnum).max(12).optional(),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
    batchSize: z.number().int().min(10).max(500).optional(),
  })
  .strict();

export const createScheduleSchema = z.object({
  name: z.string().min(1).max(150),
  provider: z.string().min(1).max(100),
  entityType: z.union([entityEnum, z.literal('import')]),
  scope: scopeSchema.default({}),
  frequencySeconds: z.number().int().min(60).max(30 * 24 * 3600),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(100),
  maxAttempts: z.number().int().min(1).max(10).default(5),
  nextRunAt: z.string().datetime({ offset: true }).optional(),
});

export const updateScheduleSchema = z.object({
  provider: z.string().min(1).max(100).optional(),
  entityType: z.union([entityEnum, z.literal('import')]).optional(),
  scope: scopeSchema.optional(),
  frequencySeconds: z.number().int().min(60).max(30 * 24 * 3600).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  nextRunAt: z.string().datetime({ offset: true }).optional(),
});

function toRow(data: unknown): ScheduleRow {
  return data as ScheduleRow;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    !!error && typeof error === 'object' && (error as { code?: string }).code === '23505'
  );
}

export async function listSchedules(client: DbClient = serviceClient()): Promise<ScheduleRow[]> {
  const { data, error } = await client.from('sync_schedules').select('*').order('name', { ascending: true });
  if (error) throw upstream('Failed to load schedules');
  return ((data as unknown[]) ?? []).map(toRow);
}

export async function getSchedule(id: string, client: DbClient = serviceClient()): Promise<ScheduleRow> {
  const { data, error } = await client.from('sync_schedules').select('*').eq('id', id).maybeSingle();
  if (error) throw upstream('Failed to load schedule');
  if (!data) throw notFound('Schedule');
  return toRow(data);
}

export async function createSchedule(
  input: z.infer<typeof createScheduleSchema>,
  client: DbClient = serviceClient(),
): Promise<ScheduleRow> {
  const { data, error } = await client
    .from('sync_schedules')
    .insert({
      name: input.name,
      provider: input.provider,
      entity_type: input.entityType,
      scope: input.scope,
      frequency_seconds: input.frequencySeconds,
      enabled: input.enabled,
      priority: input.priority,
      max_attempts: input.maxAttempts,
      next_run_at: input.nextRunAt ?? new Date().toISOString(),
    })
    .select('*');
  if (error) {
    if (isUniqueViolation(error)) throw conflict(`Schedule '${input.name}' already exists`);
    throw upstream('Failed to create schedule');
  }
  const rows = ((data as unknown[]) ?? []).map(toRow);
  if (!rows.length) throw upstream('Failed to create schedule');
  return rows[0];
}

export async function updateSchedule(
  id: string,
  input: z.infer<typeof updateScheduleSchema>,
  client: DbClient = serviceClient(),
): Promise<ScheduleRow> {
  const patch: Record<string, unknown> = {};
  if (input.provider !== undefined) patch.provider = input.provider;
  if (input.entityType !== undefined) patch.entity_type = input.entityType;
  if (input.scope !== undefined) patch.scope = input.scope;
  if (input.frequencySeconds !== undefined) patch.frequency_seconds = input.frequencySeconds;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.maxAttempts !== undefined) patch.max_attempts = input.maxAttempts;
  if (input.nextRunAt !== undefined) patch.next_run_at = input.nextRunAt;
  if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');
  const { data, error } = await client.from('sync_schedules').update(patch).eq('id', id).select('*');
  if (error) throw upstream('Failed to update schedule');
  const rows = ((data as unknown[]) ?? []).map(toRow);
  if (!rows.length) throw notFound('Schedule');
  return rows[0];
}

export async function deleteSchedule(id: string, client: DbClient = serviceClient()): Promise<void> {
  const { data, error } = await client.from('sync_schedules').delete().eq('id', id).select('id');
  if (error) throw upstream('Failed to delete schedule');
  if (!((data as unknown[]) ?? []).length) throw notFound('Schedule');
}
