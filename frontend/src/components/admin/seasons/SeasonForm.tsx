'use client';

import { useCallback } from 'react';
import { ResourceForm, type FieldSpec } from '@/components/admin/ResourceForm';
import { saveSeasonAction } from '@/app/control-center/reference/actions';
import { toFieldOptions, type OptionRow } from '@/lib/admin/options-shared';
import type { AdminSeasonRow } from '@/types/api';

/**
 * Season create/edit form.
 *
 * `competition_id` is required by the backend, so the picker is populated from
 * the real `/competitions` list — an operator cannot create an orphaned season.
 */
export function SeasonForm({
  mode,
  id,
  initial,
  competitions,
}: {
  mode: 'create' | 'edit';
  id?: string;
  initial?: AdminSeasonRow | null;
  competitions: OptionRow[];
}) {
  const action = useCallback(
    (values: Record<string, string | number | boolean | null>) =>
      saveSeasonAction(mode === 'edit' ? (id ?? null) : null, values),
    [mode, id],
  );

  const fields: FieldSpec[] = [
    {
      name: 'competition_id',
      label: 'Competition',
      kind: 'select',
      required: true,
      options: toFieldOptions(competitions),
      placeholder: 'Choose a competition',
    },
    { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 50, placeholder: '2026/27' },
    { name: 'start_date', label: 'Start date', kind: 'date' },
    { name: 'end_date', label: 'End date', kind: 'date', hint: 'Must be on or after the start date.' },
    { name: 'is_current', label: 'Current season (in progress now)', kind: 'checkbox' },
  ];

  return (
    <ResourceForm
      action={action}
      fields={fields}
      submitLabel={mode === 'create' ? 'Create season' : 'Save changes'}
      cancelHref="/control-center/seasons"
      initial={
        initial
          ? {
              competition_id: initial.competition_id,
              name: initial.name,
              start_date: initial.start_date,
              end_date: initial.end_date,
              is_current: initial.is_current,
            }
          : {}
      }
    />
  );
}