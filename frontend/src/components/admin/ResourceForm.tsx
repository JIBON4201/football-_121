'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormActions, FormSection, CheckboxField } from './ui/Form';

/**
 * Schema-driven create/edit form.
 *
 * The reference modules (team, player, competition, season, venue) have the same
 * shape: a handful of text/number/date/select/checkbox fields, a save button and
 * a cancel link. Describing them as data instead of hand-writing a form per
 * entity keeps validation and error display identical everywhere.
 *
 * Validation is deliberately shallow here. The backend is the authority — it runs
 * zod schemas and returns per-field messages, which land on the matching input.
 * The only checks duplicated client-side are "required" and basic emptiness, to
 * avoid a pointless round trip.
 */

export type FieldKind = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'url';

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** For `select`: real options loaded from an API, never hardcoded. */
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  /** Value used when the field is left blank — `null` clears a nullable column. */
  emptyValue?: string | number | boolean | null;
  /** Half-width in the two-column grid. Long fields opt out. */
  full?: boolean;
  maxLength?: number;
}

export interface ResourceFormProps {
  /** Server action. Receives a plain object of field name → value. */
  action: (values: Record<string, string | number | boolean | null>) => Promise<{ error?: string; fields?: Record<string, string> }>;
  fields: FieldSpec[];
  submitLabel: string;
  cancelHref: string;
  /** Sections group the fields; omit for a single flat form. */
  sections?: Array<{ title: string; description?: string; fields: FieldSpec[] }>;
  /** Initial values keyed by field name. */
  initial?: Record<string, string | number | boolean | null>;
}

function coerce(spec: FieldSpec, raw: FormDataEntryValue | null): string | number | boolean | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (spec.kind === 'checkbox') return value === 'on';
  if (value === '') return spec.emptyValue ?? null;
  if (spec.kind === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return value;
}

export function ResourceForm({ action, fields, submitLabel, cancelHref, sections, initial }: ResourceFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const allFields = sections ? sections.flatMap((section) => section.fields) : fields;

  function submit(formData: FormData) {
    const values: Record<string, string | number | boolean | null> = {};
    for (const spec of allFields) values[spec.name] = coerce(spec, formData.get(spec.name));

    startTransition(async () => {
      const result = await action(values);
      if (result?.error) {
        setError(result.error);
        setFieldErrors(result.fields ?? {});
        return;
      }
      setError(null);
      setFieldErrors({});
      router.push(cancelHref);
      router.refresh();
    });
  }

  function renderField(spec: FieldSpec) {
    const id = `cc-${spec.name}`;
    const initialValue = initial?.[spec.name];
    const style = spec.full ? { gridColumn: '1 / -1' } : undefined;

    if (spec.kind === 'checkbox') {
      return (
        <div key={spec.name} style={style}>
          <CheckboxField
            name={spec.name}
            label={spec.label}
            hint={spec.hint}
            defaultChecked={initialValue === true || initialValue === 'true'}
          />
        </div>
      );
    }

    return (
      <div className="cc-field" key={spec.name} style={style}>
        <label className="cc-field__label" htmlFor={id}>
          {spec.label}
          {spec.required ? (
            <span className="cc-field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>

        {spec.kind === 'select' ? (
          <select
            id={id}
            name={spec.name}
            
            defaultValue={initialValue === null || initialValue === undefined ? '' : String(initialValue)}
            required={spec.required}
            aria-invalid={fieldErrors[spec.name] ? 'true' : undefined}
            aria-describedby={fieldErrors[spec.name] ? `${id}-error` : undefined}
          >
            <option value="">{spec.placeholder ?? '— none —'}</option>
            {(spec.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : spec.kind === 'textarea' ? (
          <textarea
            id={id}
            name={spec.name}
            
            rows={4}
            defaultValue={initialValue === null || initialValue === undefined ? '' : String(initialValue)}
            required={spec.required}
            maxLength={spec.maxLength}
            aria-invalid={fieldErrors[spec.name] ? 'true' : undefined}
            aria-describedby={fieldErrors[spec.name] ? `${id}-error` : undefined}
          />
        ) : (
          <input
            id={id}
            name={spec.name}
            
            type={spec.kind === 'number' ? 'number' : spec.kind === 'date' ? 'date' : spec.kind === 'url' ? 'url' : 'text'}
            defaultValue={initialValue === null || initialValue === undefined ? '' : String(initialValue)}
            required={spec.required}
            placeholder={spec.placeholder}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            maxLength={spec.maxLength}
            aria-invalid={fieldErrors[spec.name] ? 'true' : undefined}
            aria-describedby={fieldErrors[spec.name] ? `${id}-error` : undefined}
          />
        )}

        {fieldErrors[spec.name] ? (
          <p className="cc-field__error" id={`${id}-error`} role="alert">
            {fieldErrors[spec.name]}
          </p>
        ) : spec.hint ? (
          <p className="cc-field__hint">{spec.hint}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={submit}
      className="cc-form"
      // Server-side validation is authoritative; don't let the browser block
      // submission on its own rules, which would hide the backend's messages.
      noValidate
    >
      {error ? (
        <div className="cc-state cc-state--error" role="alert">
          <p className="cc-state__message">{error}</p>
        </div>
      ) : null}

      {sections ? (
        sections.map((section) => (
          <FormSection key={section.title} title={section.title} description={section.description}>
            {section.fields.map(renderField)}
          </FormSection>
        ))
      ) : (
        <FormSection title="Details">
          {fields.map(renderField)}
        </FormSection>
      )}

      <FormActions>
        <button type="submit" className="cc-button cc-button--primary" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        <a className="cc-button cc-button--ghost" href={cancelHref}>
          Cancel
        </a>
      </FormActions>
    </form>
  );
}