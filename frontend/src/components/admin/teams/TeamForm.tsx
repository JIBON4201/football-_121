'use client';

import { useCallback } from 'react';
import { ResourceForm, type FieldSpec } from '@/components/admin/ResourceForm';
import { saveTeamAction } from '@/app/control-center/reference/actions';
import { toFieldOptions } from '@/lib/admin/options-shared';
import type { AdminTeamRow } from '@/types/api';

/**
 * Team create/edit form.
 *
 * Options come from the real endpoints (`/countries`, `/admin/venues`) — nothing
 * is hardcoded, so a newly created venue appears here on the next load.
 *
 * The action is chosen by `mode` here in the client, but the server action
 * independently derives the required permission from whether an id is present,
 * so this choice cannot escalate anything.
 */
export function TeamForm({
  mode,
  id,
  initial,
  countries,
  venues,
}: {
  mode: 'create' | 'edit';
  id?: string;
  initial?: AdminTeamRow | null;
  countries: Array<{ id: string; label: string }>;
  venues: Array<{ id: string; label: string }>;
}) {
  const action = useCallback(
    (values: Record<string, string | number | boolean | null>) =>
      saveTeamAction(mode === 'edit' ? (id ?? null) : null, values),
    [mode, id],
  );

  const fields: FieldSpec[] = [
    { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 150, placeholder: 'Eastvale City' },
    { name: 'short_name', label: 'Short name', kind: 'text', maxLength: 80, placeholder: 'EVC' },
    {
      name: 'slug',
      label: 'Slug',
      kind: 'text',
      maxLength: 150,
      hint: 'Leave blank to generate from the name. Changing it later breaks existing links.',
    },
    { name: 'country_id', label: 'Country', kind: 'select', options: toFieldOptions(countries), placeholder: '— none —' },
    { name: 'venue_id', label: 'Home venue', kind: 'select', options: toFieldOptions(venues), placeholder: '— none —' },
    { name: 'founded_year', label: 'Founded', kind: 'number', min: 1800, max: 2100 },
    { name: 'logo_url', label: 'Logo URL', kind: 'url', full: true, placeholder: 'https://… or /path' },
    { name: 'website_url', label: 'Website', kind: 'url', full: true, placeholder: 'https://…' },
    { name: 'is_active', label: 'Active (visible on the public site)', kind: 'checkbox' },
  ];

  return (
    <ResourceForm
      action={action}
      fields={fields}
      submitLabel={mode === 'create' ? 'Create team' : 'Save changes'}
      cancelHref="/control-center/teams"
      initial={
        initial
          ? {
              name: initial.name,
              short_name: initial.short_name,
              slug: initial.slug,
              country_id: initial.country_id,
              venue_id: initial.venue_id,
              founded_year: initial.founded_year,
              logo_url: initial.logo_url,
              website_url: initial.website_url,
              is_active: initial.is_active,
            }
          : { is_active: true }
      }
    />
  );
}