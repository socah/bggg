'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface BggAccount {
  bggUsername: string;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    return Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export function BggAccountSettings() {
  const [account, setAccount] = useState<BggAccount | null>(null);
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'unlinking'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch('/bgg-account')
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response));
        // The API wraps the link in an envelope — a bare null return would
        // serialize as an empty body, which json() can't parse.
        return response.json() as Promise<{ account: BggAccount | null }>;
      })
      .then(({ account: nextAccount }) => {
        if (!cancelled) {
          setAccount(nextAccount);
          setUsername(nextAccount?.bggUsername ?? '');
          setStatus('idle');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'Unable to load BGG settings');
          setStatus('idle');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      setMessage('Enter your BoardGameGeek username.');
      return;
    }
    setStatus('saving');
    setMessage(null);
    try {
      const response = await apiFetch('/bgg-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bggUsername: trimmed }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const nextAccount = (await response.json()) as BggAccount;
      setAccount(nextAccount);
      setUsername(nextAccount.bggUsername);
      setMessage('BGG account linked.');
      setStatus('idle');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Unable to link BGG account');
      setStatus('idle');
    }
  }

  async function unlink() {
    setStatus('unlinking');
    setMessage(null);
    try {
      const response = await apiFetch('/bgg-account', { method: 'DELETE' });
      if (!response.ok) throw new Error(await errorMessage(response));
      setAccount(null);
      setUsername('');
      setMessage('BGG account unlinked. Imported games remain in your collection.');
      setStatus('idle');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Unable to unlink BGG account');
      setStatus('idle');
    }
  }

  return (
    <Card className="max-w-xl p-4">
      <p className="text-sm text-text-muted">
        Link your BGG username to import the games you own.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 font-body text-sm font-semibold">
          BGG username
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="your BGG username"
            disabled={status === 'loading' || status === 'saving' || status === 'unlinking'}
          />
        </label>
        <Button type="submit" disabled={status === 'loading' || status === 'saving' || status === 'unlinking'}>
          {status === 'saving' ? 'Linking…' : account ? 'Update link' : 'Link account'}
        </Button>
      </form>
      {account && (
        <Button type="button" variant="ghost" onClick={unlink} disabled={status !== 'idle'} className="mt-2 px-0">
          {status === 'unlinking' ? 'Unlinking…' : 'Unlink account'}
        </Button>
      )}
      {message && <p className="mt-3 text-sm text-text-muted" role="status">{message}</p>}
    </Card>
  );
}
