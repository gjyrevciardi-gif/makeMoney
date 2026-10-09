'use client';

import Link from 'next/link';
import { ChangePasswordForm } from '../../../components/account/change-password-form';
import { AppShell } from '../../../components/shell/app-shell';
import { useSession } from '../../../lib/queries';

export default function ChangePasswordPage() {
  const session = useSession();
  return (
    <AppShell>
      <div className="page">
        <div className="page-head">
          <div>
            <p className="kicker">Account</p>
            <h1>Change password</h1>
          </div>
          <Link className="btn btn-sm" href="/account">Back to account</Link>
        </div>
        {!session.isPending && !session.data
          ? (
            <div className="empty-state">
              <strong>You are signed out.</strong>
              <Link className="btn btn-sm btn-primary" href="/login">Sign in</Link>
            </div>
          )
          : <ChangePasswordForm />}
      </div>
    </AppShell>
  );
}
