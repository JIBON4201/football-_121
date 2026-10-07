import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  children: ReactNode;
}

/** Accessible button with visible focus (see globals.css :focus-visible). */
export function Button({ variant = 'primary', type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} data-variant={variant} {...rest}>
      {children}
    </button>
  );
}

interface ActionLinkProps {
  href: string;
  children: ReactNode;
  ariaLabel?: string;
}

export function ActionLink({ href, children, ariaLabel }: ActionLinkProps) {
  return (
    <a href={href} aria-label={ariaLabel}>
      {children}
    </a>
  );
}
