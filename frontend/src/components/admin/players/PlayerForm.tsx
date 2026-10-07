'use client';

import { useCallback } from 'react';
import { ResourceForm, type FieldSpec } from '@/components/admin/ResourceForm';
import { savePlayerAction } from '@/app/control-center/reference/actions';
import { toFieldOptions } from '@/lib/admin/options-shared';
import type { OptionRow } from '@/lib/admin/options-shared';
import type { AdminPlayerRow } from '@/types/api';

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'] as const;
const FEET = ['left', 'right', 'both'] as const;
const STATUSES = ['active', 'injured', 'loaned', 'retired'] as const;

/** Player create/edit form. Nationality options come from `/countries`. */
export function PlayerForm({
  mode,
  id,
  initial,
  countries,
}: {
  mode: 'create' | 'edit';
  id?: string;
  initial?: AdminPlayerRow | null;
  countries: OptionRow[];
}) {
  const action = useCallback(
    (values: Record<string, string | number | boolean | null>) =>
      savePlayerAction(mode === 'edit' ? (id ?? null) : null, values),
    [mode, id],
  );

  const fields: FieldSpec[] = [
    { name: 'display_name', label: 'Display name', kind: 'text', required: true, maxLength: 150, placeholder: 'Carlos Mendez' },
    { name: 'first_name', label: 'First name', kind: 'text', maxLength: 80 },
    { name: 'last_name', label: 'Last name', kind: 'text', maxLength: 80 },
    { name: 'slug', label: 'Slug', kind: 'text', maxLength: 150, hint: 'Leave blank to generate from the display name.' },
    { name: 'nationality_id', label: 'Nationality', kind: 'select', options: toFieldOptions(countries), placeholder: '— none —' },
    {
      name: 'position',
      label: 'Position',
      kind: 'select',
      options: POSITIONS.map((value) => ({ value, label: value })),
      placeholder: '— none —',
    },
    {
      name: 'preferred_foot',
      label: 'Preferred foot',
      kind: 'select',
      options: FEET.map((value) => ({ value, label: value })),
      placeholder: '— none —',
    },
    {
      name: 'status',
      label: 'Status',
      kind: 'select',
      options: STATUSES.map((value) => ({ value, label: value })),
      placeholder: '— none —',
    },
    { name: 'date_of_birth', label: 'Date of birth', kind: 'date' },
    { name: 'height_cm', label: 'Height (cm)', kind: 'number', min: 100, max: 250 },
    { name: 'photo_url', label: 'Photo URL', kind: 'url', full: true, placeholder: 'https://…' },
  ];

  return (
    <ResourceForm
      action={action}
      fields={fields}
      submitLabel={mode === 'create' ? 'Create player' : 'Save changes'}
      cancelHref="/control-center/players"
      initial={
        initial
          ? {
              display_name: initial.display_name,
              first_name: initial.first_name,
              last_name: initial.last_name,
              slug: initial.slug,
              nationality_id: initial.nationality_id,
              position: initial.position,
              preferred_foot: initial.preferred_foot,
              status: initial.status,
              date_of_birth: initial.date_of_birth,
              height_cm: initial.height_cm,
              photo_url: initial.photo_url,
            }
          : {}
      }
    />
  );
}