import type { ReactNode } from 'react';

/**
 * Form primitives.
 *
 * `Field` owns the label/control/hint/error wiring so every input in the panel
 * is labelled, describes its own error, and marks required fields the same way.
 * The control itself is passed as children, which keeps these usable from both
 * server and client components — no hooks, no context.
 */

export interface FieldProps {
  /** Must match the control's id. */
  htmlFor: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Renders the control to the right of the label (e.g. a character count). */
  aside?: ReactNode;
  children: ReactNode;
}

export function Field({ htmlFor, label, required = false, hint, error, aside, children }: FieldProps) {
  return (
    <div className="cc-field">
      <label className="cc-field__label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="cc-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
        {aside ? <span style={{ marginLeft: 'auto' }}>{aside}</span> : null}
      </label>
      {children}
      {error ? (
        <p className="cc-field__error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="cc-field__hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A titled group of related fields. Long forms (match, article, transfer) are
 * split into these so the page reads as sections rather than one wall of inputs.
 */
export function FormSection({
  title,
  description,
  columns = 2,
  children,
}: {
  title: string;
  description?: string;
  columns?: 1 | 2 | 3;
  children: ReactNode;
}) {
  return (
    <section className="cc-form-section">
      <div className="cc-form-section__head">
        <h2 className="cc-form-section__title">{title}</h2>
        {description ? <p className="cc-form-section__description">{description}</p> : null}
      </div>
      <div
        className="cc-grid"
        style={columns > 1 ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      >
        {children}
      </div>
    </section>
  );
}

/** Sticky save/cancel bar. */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="cc-form__actions">{children}</div>;
}

/** Checkbox with a label, used for boolean fields. */
export function CheckboxField({
  name,
  label,
  defaultChecked,
  hint,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--cc-space-1)' }}>
      <label className="cc-checkbox">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} />
        <span>{label}</span>
      </label>
      {hint ? <p className="cc-field__hint">{hint}</p> : null}
    </div>
  );
}

/** Read-only label/value pair, for detail pages. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}