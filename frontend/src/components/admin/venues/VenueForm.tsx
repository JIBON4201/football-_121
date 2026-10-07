'use client';

import { useCallback } from 'react';
import { ResourceForm, type FieldSpec } from '@/components/admin/ResourceForm';
import { saveVenueAction } from '@/app/control-center/reference/actions';
import { toFieldOptions, type OptionRow } from '@/lib/admin/options-shared';
import type { AdminVenueRow } from '@/types/api';

/** Venue create/edit form. Country options come from `/countries`. */
export function VenueForm({
  mode,
  id,
  initial,
  countries,
}: {
  mode: 'create' | 'edit';
  id?: string;
  initial?: AdminVenueRow | null;
  countries: OptionRow[];
}) {
  const action = useCallback(
    (values: Record<string, string | number | boolean | null>) =>
      saveVenueAction(mode === 'edit' ? (id ?? null) : null, values),
    [mode, id],
  );

  const fields: FieldSpec[] = [
    { name: 'name', label: 'Name', kind: 'text', required: true, maxLength: 150, placeholder: 'Eastvale Stadium' },
    { name: 'slug', label: 'Slug', kind: 'text', maxLength: 150, hint: 'Leave blank to generate from the name.' },
    { name: 'city', label: 'City', kind: 'text', maxLength: 120 },
    { name: 'country_id', label: 'Country', kind: 'select', options: toFieldOptions(countries), placeholder: '— none —' },
    { name: 'capacity', label: 'Capacity', kind: 'number', min: 0 },
    { name: 'latitude', label: 'Latitude', kind: 'number', step: 0.0001, min: -90, max: 90 },
    { name: 'longitude', label: 'Longitude', kind: 'number', step: 0.0001, min: -180, max: 180 },
    { name: 'image_url', label: 'Image URL', kind: 'url', full: true, placeholder: 'https://… or /path' },
  ];

  return (
    <ResourceForm
      action={action}
      fields={fields}
      submitLabel={mode === 'create' ? 'Create venue' : 'Save changes'}
      cancelHref="/control-center/venues"
      initial={
        initial
          ? {
              name: initial.name,
              slug: initial.slug,
              city: initial.city,
              country_id: initial.country_id,
              capacity: initial.capacity,
              latitude: initial.latitude,
              longitude: initial.longitude,
              image_url: initial.image_url,
            }
          : {}
      }
    />
  );
}