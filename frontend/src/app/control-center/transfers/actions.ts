'use server';

import { redirect } from 'next/navigation';
import { createAdminTransfer, deleteAdminTransfer, updateAdminTransfer } from '@/lib/admin/transfers';
import { revalidatePublic } from '@/lib/admin/revalidate';
import { adminFailureMessage } from '@/lib/admin/resource';
import { getAdminSession } from '@/lib/admin-session';
import { ADMIN_TRANSFER_STATUSES, ADMIN_TRANSFER_TYPES } from '@/types/api';

/**
 * Step 19 — server actions for the transfers module. The client form validates
 * for UX; these re-check the same rules and the permission set so a hostile
 * FormData never reaches the API. Backend authorization remains authoritative.
 */
export interface TransferFormState {
  error?: string;
  success?: string;
  fields?: Record<string, string>;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateTransferForm(formData: FormData): {
  error?: TransferFormState;
  values?: {
    player_id: string;
    season_id: string;
    transfer_type: string;
    status: string | undefined;
    from_team_id: string | null;
    to_team_id: string | null;
    window_id: string | null;
    fee: number | null;
    currency: string | null;
    announcement_date: string | null;
    effective_date: string | null;
  };
} {
  const player_id = str(formData.get('player_id'));
  const season_id = str(formData.get('season_id'));
  const transfer_type = str(formData.get('transfer_type'));
  const status = str(formData.get('status'));
  const from_team_id = str(formData.get('from_team_id'));
  const to_team_id = str(formData.get('to_team_id'));
  const window_id = str(formData.get('window_id'));
  const feeRaw = str(formData.get('fee'));
  const currency = str(formData.get('currency'));
  const announcement_date = str(formData.get('announcement_date'));
  const effective_date = str(formData.get('effective_date'));

  const fields: Record<string, string> = {};
  if (!UUID.test(player_id)) fields.player_id = 'Choose a player.';
  if (!UUID.test(season_id)) fields.season_id = 'Choose a season.';
  if (!(ADMIN_TRANSFER_TYPES as readonly string[]).includes(transfer_type)) fields.transfer_type = 'Choose a valid transfer type.';
  if (status && !(ADMIN_TRANSFER_STATUSES as readonly string[]).includes(status)) fields.status = 'Invalid status.';
  if (from_team_id && !UUID.test(from_team_id)) fields.from_team_id = 'Choose a valid from-team.';
  if (to_team_id && !UUID.test(to_team_id)) fields.to_team_id = 'Choose a valid to-team.';
  if (window_id && !UUID.test(window_id)) fields.window_id = 'Choose a valid window.';
  if (from_team_id && to_team_id && from_team_id === to_team_id) fields.to_team_id = 'From and to teams must differ.';
  if (feeRaw && (Number.isNaN(Number(feeRaw)) || Number(feeRaw) < 0)) fields.fee = 'Fee must be a non-negative number.';
  if (currency && !/^[A-Z]{3}$/.test(currency)) fields.currency = 'Currency must be a 3-letter uppercase code (e.g. EUR).';
  if (announcement_date && Number.isNaN(Date.parse(announcement_date))) fields.announcement_date = 'Invalid announcement date.';
  if (effective_date && Number.isNaN(Date.parse(effective_date))) fields.effective_date = 'Invalid effective date.';
  if (announcement_date && effective_date && Date.parse(effective_date) < Date.parse(announcement_date)) {
    fields.effective_date = 'Effective date must be on or after the announcement date.';
  }

  if (Object.keys(fields).length > 0) {
    return { error: { error: 'Please fix the highlighted fields.', fields } };
  }
  // Normalise to a full ISO datetime (datetime-local inputs and date inputs
  // both parse); the backend schema requires an explicit offset.
  const toIso = (v: string): string | null => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  return {
    values: {
      player_id,
      season_id,
      transfer_type,
      status: status || undefined,
      from_team_id: from_team_id || null,
      to_team_id: to_team_id || null,
      window_id: window_id || null,
      fee: feeRaw === '' ? null : Number(feeRaw),
      currency: currency || null,
      announcement_date: toIso(announcement_date),
      effective_date: toIso(effective_date),
    },
  };
}

export async function createTransferAction(_prev: TransferFormState, formData: FormData): Promise<TransferFormState> {
  const session = await getAdminSession();
  if (session.status !== 'ok') return { error: 'Your session has expired. Please sign in again.' };
  if (!session.user.permissions.includes('transfers.create')) return { error: 'You do not have permission to create transfers.' };

  const check = validateTransferForm(formData);
  if (check.error) return check.error;

  const result = await createAdminTransfer(check.values!);
if (result.status === 'forbidden') return { error: 'You do not have permission to create transfers.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  if (result.status === 'not-found') return { error: 'A referenced record no longer exists.' };
  if (result.status === 'conflict') return { error: result.message };
  // Same detail as `update`: a generic banner would hide which field the
  // backend rejected (e.g. a fee without a matching currency code).
  if (result.status === 'invalid') return { error: result.message, fields: result.fields };
  if (result.status === 'rate-limited') {
    const wait = result.retryAfterSeconds ? ` Try again in ${result.retryAfterSeconds}s.` : '';
    return { error: `${result.message}${wait}` };
  }
  if (result.status !== 'ok') return { error: adminFailureMessage(result) };
  revalidatePublic('transfers');
  redirect(`/control-center/transfers/${result.transfer.id}/edit?created=1`);
}

export async function updateTransferAction(id: string, _prev: TransferFormState, formData: FormData): Promise<TransferFormState> {
  const session = await getAdminSession();
  if (session.status !== 'ok') return { error: 'Your session has expired. Please sign in again.' };
  if (!session.user.permissions.includes('transfers.update')) return { error: 'You do not have permission to edit transfers.' };

  const check = validateTransferForm(formData);
  if (check.error) return check.error;
  const v = check.values!;

  const result = await updateAdminTransfer(id, {
    player_id: v.player_id,
    season_id: v.season_id,
    transfer_type: v.transfer_type,
    status: v.status,
    from_team_id: v.from_team_id as string | null,
    to_team_id: v.to_team_id as string | null,
    window_id: v.window_id as string | null,
    fee: v.fee,
    currency: v.currency,
    announcement_date: v.announcement_date,
    effective_date: v.effective_date,
  });
  if (result.status === 'forbidden') return { error: 'You do not have permission to edit this transfer.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
if (result.status === 'not-found') return { error: 'This transfer no longer exists.' };
  if (result.status === 'invalid') return { error: result.message, fields: result.fields };
  if (result.status !== 'ok') return { error: adminFailureMessage(result) };
  revalidatePublic('transfers');
  return { success: 'Changes saved.' };
}

export async function deleteTransferAction(id: string): Promise<TransferFormState> {
  const session = await getAdminSession();
  if (session.status !== 'ok') return { error: 'Your session has expired. Please sign in again.' };
  if (!session.user.permissions.includes('transfers.delete')) return { error: 'You do not have permission to delete transfers.' };
  const result = await deleteAdminTransfer(id);
  if (result.status === 'ok') {
    revalidatePublic('transfers');
    return { success: 'Transfer deleted.' };
  }
if (result.status === 'forbidden') return { error: 'You are not allowed to delete this transfer.' };
  if (result.status === 'unauthenticated') return { error: 'Your session has expired. Please sign in again.' };
  return { error: adminFailureMessage(result) };
}
