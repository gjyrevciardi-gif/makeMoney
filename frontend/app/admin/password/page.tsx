'use client';

import { AdminAccessGate } from '../../../components/admin/admin-access-gate';
import { ChangePasswordForm } from '../../../components/account/change-password-form';
import { useSession } from '../../../lib/queries';

export default function AdminPasswordPage() {
  const session = useSession();
  if (!session.isPending && (!session.data || session.data.role === 'USER')) return <AdminAccessGate area="Change password" />;
  return (
    <div className="ops-content">
      <section className="ops-hero">
        <div>
          <p className="ops-kicker">MY ACCOUNT</p>
          <h1>Change password</h1>
          <p>Pick a new password for your own login. You will be signed out everywhere and sign in again with it.</p>
        </div>
      </section>
      <ChangePasswordForm />
    </div>
  );
}
