'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useEffect, useRef } from 'react';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cc-button cc-button--primary" disabled={pending} aria-busy={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

/**
 * Credentials exist only in React state for the lifetime of the submit and are
 * posted straight to the server action — nothing is persisted client-side.
 */
export function LoginForm() {
  const [state, formAction] = useFormState(loginAction, initialState);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  return (
    <form action={formAction} className="cc-login__form" noValidate>
      <div className="cc-field">
        <label htmlFor="cc-email">Email</label>
        <input
          id="cc-email"
          ref={emailRef}
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.fields?.email ?? ''}
        />
      </div>
      <div className="cc-field">
        <label htmlFor="cc-password">Password</label>
        <input id="cc-password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error ? (
        <p className="cc-alert" role="alert">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}