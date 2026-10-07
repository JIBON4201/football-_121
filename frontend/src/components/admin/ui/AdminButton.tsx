import Link from 'next/link';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { AdminIcon, type AdminIconName } from './AdminIcon';

/**
 * The one button in the Control Center.
 *
 * Five intents (primary / secondary / ghost / danger / solid-danger) plus two
 * sizes and an icon-only mode, so no page invents its own button styling.
 * `AdminButton` renders a real <button>; `AdminLinkButton` renders a real
 * <Link> — navigation never masquerades as a submit, which keeps Enter-key and
 * screen-reader behaviour correct.
 *
 * Refs are forwarded so callers can move focus (the confirm dialog focuses its
 * primary action on open).
 */

export type AdminButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'solid-danger';
export type AdminButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASS: Record<AdminButtonVariant, string> = {
  primary: 'cc-btn--primary',
  secondary: 'cc-btn--secondary',
  ghost: 'cc-btn--ghost',
  danger: 'cc-btn--danger',
  'solid-danger': 'cc-btn--solid-danger',
};

const SIZE_CLASS: Record<AdminButtonSize, string> = {
  sm: 'cc-btn--sm',
  md: '',
  lg: 'cc-btn--lg',
};

function classesFor(variant: AdminButtonVariant, size: AdminButtonSize, iconOnly: boolean, extra?: string): string {
  return ['cc-btn', VARIANT_CLASS[variant], SIZE_CLASS[size], iconOnly ? 'cc-btn--icon' : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

export interface AdminButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'className'> {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  icon?: AdminIconName;
  /** Renders icon-only; `aria-label` becomes required in practice. */
  iconOnly?: boolean;
  /** Blocks interaction and marks the control busy while an action is in flight. */
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
  children?: ReactNode;
}

export const AdminButton = forwardRef<HTMLButtonElement, AdminButtonProps>(function AdminButton(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconOnly = false,
    loading = false,
    loadingLabel,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classesFor(variant, size, iconOnly, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon ? <AdminIcon name={icon} size={size === 'sm' ? 14 : 15} /> : null}
      {iconOnly ? null : children}
      {loading ? <span className="cc-visually-hidden">{loadingLabel ?? 'Working'}</span> : null}
    </button>
  );
});

export interface AdminLinkButtonProps extends Omit<ComponentPropsWithoutRef<typeof Link>, 'className'> {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  icon?: AdminIconName;
  iconOnly?: boolean;
  className?: string;
  children?: ReactNode;
}

export function AdminLinkButton({
  variant = 'secondary',
  size = 'md',
  icon,
  iconOnly = false,
  className,
  children,
  ...rest
}: AdminLinkButtonProps) {
  return (
    <Link className={classesFor(variant, size, iconOnly, className)} {...rest}>
      {icon ? <AdminIcon name={icon} size={size === 'sm' ? 14 : 15} /> : null}
      {iconOnly ? null : children}
    </Link>
  );
}