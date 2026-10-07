import { logoutAction } from '@/app/control-center/login/actions';

/**
 * 403 state for a signed-in user without an active Admin grant. Kept distinct
 * from the login redirect so "authenticated but not authorised" is never
 * mistaken for "not signed in", and so the reason stays visible.
 */
export function AccessDenied() {
  return (
    <main id="main-content" className="cc-denied">
      <h1>Access denied</h1>
      <p>Your account does not have an active Control Center grant. Ask an administrator for access.</p>
      <form action={logoutAction}>
        <button type="submit" className="cc-button cc-button--ghost">
          Sign out
        </button>
      </form>
    </main>
  );
}