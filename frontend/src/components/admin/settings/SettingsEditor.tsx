'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveSettingAction } from '@/app/control-center/reference/actions';
import type { AdminSettingRow } from '@/types/api';

/**
 * Inline editor for `system_settings`.
 *
 * Each key/value pair saves on its own so one bad value cannot block the rest of
 * the page. Values arrive as JSON (the column is `jsonb`), so a non-string is
 * serialised on save and a JSON object/array is edited as raw JSON with the
 * parse error surfaced inline rather than silently dropped.
 */
export function SettingsEditor({ settings, canManage }: { settings: AdminSettingRow[]; canManage: boolean }) {
  if (settings.length === 0) return null;

  const sorted = [...settings].sort((a, b) => a.key.localeCompare(b.key));

  return (
    <div className="cc-table-wrap">
      <table>
        <caption className="cc-visually-hidden">Site settings</caption>
        <thead>
          <tr>
            <th scope="col" data-primary="true">
              Key
            </th>
            <th scope="col">Value</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((setting) => (
            <SettingRow key={setting.key} setting={setting} canManage={canManage} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingRow({ setting, canManage }: { setting: AdminSettingRow; canManage: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => stringifyValue(setting.value));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveSettingAction(setting.key, draft);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <tr>
      <td data-primary="true" data-label="Key">
        <code className="cc-ref">{setting.key}</code>
      </td>
      <td data-label="Value">
        {canManage ? (
          <>
            <input
              aria-label={`Value for ${setting.key}`}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaved(false);
              }}
              aria-invalid={error ? 'true' : undefined}
            />
            {error ? (
              <p className="cc-field__error" role="alert">
                {error}
              </p>
            ) : saved ? (
              <p className="cc-field__hint">Saved</p>
            ) : null}
          </>
        ) : (
          <span className="cc-ellipsis">{draft}</span>
        )}
      </td>
      <td data-label="Description">
        {canManage ? (
          <button type="button" className="cc-button cc-button--primary cc-button--sm" onClick={save} disabled={pending}>
            {pending ? 'Saving...' : 'Save'}
          </button>
        ) : (
          <span className="cc-muted">Read only</span>
        )}
        {setting.description ? <p className="cc-field__hint">{setting.description}</p> : null}
      </td>
    </tr>
  );
}

/** Render a JSON column value as an editable string. */
function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}