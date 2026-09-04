'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface InvitePageProps {
  token: string;
}

interface InvitePreview {
  groupName: string;
  role: 'admin' | 'member';
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    return Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export function InvitePage({ token }: InvitePageProps) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [status, setStatus] = useState<'loading' | 'idle' | 'submitting'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return response.json() as Promise<InvitePreview>;
      })
      .then((data) => {
        if (!cancelled) {
          setPreview(data);
          setStatus('idle');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : 'This invite is not available.');
          setStatus('idle');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');
    setMessage(null);

    try {
      if (session?.user) {
        const response = await apiFetch(`/invites/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
        });
        if (!response.ok) throw new Error(await responseMessage(response));
        router.push('/calendar');
        return;
      }

      const response = await fetch(`/api/invites/${encodeURIComponent(token)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));

      router.push(`/web/login?callbackUrl=${encodeURIComponent('/calendar')}`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Unable to accept this invite.');
      setStatus('idle');
    }
  }

  const ready = status === 'idle' && sessionStatus !== 'loading';

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md p-6">
        <p className="font-display text-sm uppercase tracking-wide text-text-muted">Group invitation</p>
        {status === 'loading' && <p className="mt-4 text-text-muted">Checking this invite…</p>}
        {message && <p className="mt-4 rounded-sm border border-accent bg-surface px-3 py-2 text-text" role="alert">{message}</p>}
        {preview && (
          <>
            <h1 className="mt-2 font-display text-3xl">Join {preview.groupName}</h1>
            <p className="mt-2 text-text-muted">You’ll join as a {preview.role}.</p>
            {ready && (
              <form onSubmit={accept} className="mt-6 flex flex-col gap-3">
                {!session?.user && (
                  <>
                    <label className="flex flex-col gap-1 text-sm font-semibold">
                      Username
                      <Input
                        required
                        minLength={3}
                        maxLength={64}
                        autoComplete="username"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold">
                      Password
                      <Input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                    </label>
                  </>
                )}
                <Button type="submit">
                  {session?.user ? 'Join group' : 'Create account and join'}
                </Button>
                {!session?.user && (
                  <a
                    href={`/web/login?callbackUrl=${encodeURIComponent(`/invites/${token}`)}`}
                    className="text-center text-sm font-semibold text-text underline decoration-accent underline-offset-4"
                  >
                    Already have an account? Sign in to accept
                  </a>
                )}
              </form>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
