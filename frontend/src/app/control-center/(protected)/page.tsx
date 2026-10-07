import { redirect } from 'next/navigation';

/** `/control-center` is the entry alias; the real landing page is the dashboard. */
export default function ControlCenterIndex() {
  redirect('/control-center/dashboard');
}