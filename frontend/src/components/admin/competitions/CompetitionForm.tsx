'use client';

import { useCallback } from 'react';
import { ResourceForm, type FieldSpec } from '@/components/admin/ResourceForm';
import { saveCompetitionAction } from '@/app/control-center/reference/actions';
import { toFieldOptions, type OptionRow } from '@/lib/admin/options-shared';
import type { AdminCompetitionRow } from '@/types/api';

const TYPES = ['league', 'cup', 'tournament'] as const;
const GENDERS = ['male', 'female', 'mixed'] as const;

/** Competition create/edit form. Country options come from `/countries`. */
export function CompetitionForm({
  mode,
  id,
  initial,
  countries,
}: {
  mode: 'create' | 'edit';
  id?: string;
  initial?: AdminCompetitionRow | null;
  countries: OptionRow[];
}) {
  const action = useCallback(
    (values: Record<string, string | number | boolean | null>) =>
      saveCompetitionAction(mode === 'edit' ? (id ?? null) : null, values),
    [mode, id],
  );

  const fields: FieldSpec[] = [
    { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 150, placeholder: 'Premier League' },
    { name: 'short_name', label: 'Short name', kind: 'text', maxLength: 80, placeholder: 'EPL' },
    { name: 'slug', label: 'Slug', kind: 'text', maxLength: 150, hint: 'Leave blank to generate from the name.' },
    { name: 'country_id', label: 'Country', kind: 'select', options: toFieldOptions(countries), placeholder: '— none —' },
    {
      name: 'type',
      label: 'Type',
      kind: 'select',
      options: TYPES.map((value) => ({ value, label: value })),
      placeholder: '— none —',
    },
    {
      name: 'gender',
      label: 'Gender',
      kind: 'select',
      options: GENDERS.map((value) => ({ value, label: value })),
      placeholder: '— none —',
    },
    { name: 'logo_url', label: 'Logo URL', kind: 'url', full: true, placeholder: 'https://… or /path' },
    { name: 'is_active', label: 'Active (visible on the public site)', kind: 'checkbox' },
  ];

  return (
    <ResourceForm
      action={action}
      fields={fields}
      submitLabel={mode === 'create' ? 'Create competition' : 'Save changes'}
      cancelHref="/control-center/competitions"
      initial={
        initial
          ? {
              name: initial.name,
              short_name: initial.short_name,
              slug: initial.slug,
              country_id: initial.country_id,
              type: initial.type,
              gender: initial.gender,
              logo_url: initial.logo_url,
              is_active: initial.is_active,
            }
          : { is_active: true }
      }
    />
  );
}