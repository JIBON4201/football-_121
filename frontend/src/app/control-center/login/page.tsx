import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/admin-session';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Sign in · Control Center',
  robots: { index: false, follow: false },
};

/**
 * Entry gate for the Admin Panel. An operator who already holds a valid Admin
 * session is sent straight to the dashboard instead of seeing the form.
 */
export default async function LoginPage() {
  const session = await getAdminSession();
  if (session.status === 'ok') redirect('/control-center/dashboard');
  return (
    <main className="cc-login" id="main-content">
      <div className="cc-login__card">
        <h1 className="cc-login__title">Control Center</h1>
        <p className="cc-login__subtitle">Sign in with your staff account to continue.</p>
        <LoginForm />
      </div>
    </main>
  );
}