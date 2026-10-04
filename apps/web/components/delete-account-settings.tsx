'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { apiMutate, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function DeleteAccountSettings() {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    if (!window.confirm('Delete your account permanently? Your personal data will be removed. Shared play history will be kept under a deleted-user label.')) return;
    setDeleting(true);
    setError(null);
    try {
      await apiMutate('/users/me', 'DELETE');
      await signOut({ redirectTo: '/web/logout' });
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Unable to delete account');
      setDeleting(false);
    }
  }

  return (
    <div>
      <p className="max-w-2xl text-sm text-text-muted">Delete your profile, personal game data, and direct chats. Shared groups, sessions, and logged plays are preserved and shown under a deleted-user label.</p>
      <Button type="button" variant="secondary" className="mt-4 text-accent" disabled={deleting} onClick={() => void deleteAccount()}>{deleting ? 'Deleting account...' : 'Delete account'}</Button>
      {error && <p className="mt-3 text-sm text-accent" role="alert">{error}</p>}
    </div>
  );
}
