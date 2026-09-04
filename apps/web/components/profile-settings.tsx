'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Profile {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    return Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}

export function ProfileSettings() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch('/users/me')
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseMessage(response));
        return response.json() as Promise<Profile>;
      })
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setEmail(data.email);
        setFirstName(data.firstName);
        setLastName(data.lastName);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Unable to load profile');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await apiFetch('/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const updated = (await response.json()) as Profile;
      setProfile(updated);
      setEmail(updated.email);
      setFirstName(updated.firstName);
      setLastName(updated.lastName);
      setMessage('Profile saved. Your updated name will appear after your next sign-in.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Unable to save profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-xl p-4">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
          Username
          <Input value={profile?.username ?? ''} disabled aria-describedby="username-help" />
          <span id="username-help" className="text-xs font-normal text-text-muted">Your sign-in username cannot be changed.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          First name <span className="font-normal text-text-muted">(optional)</span>
          <Input maxLength={100} autoComplete="given-name" value={firstName} disabled={!profile || saving} onChange={(event) => setFirstName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Last name <span className="font-normal text-text-muted">(optional)</span>
          <Input maxLength={100} autoComplete="family-name" value={lastName} disabled={!profile || saving} onChange={(event) => setLastName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">
          Email <span className="font-normal text-text-muted">(optional)</span>
          <Input type="email" maxLength={254} autoComplete="email" value={email} disabled={!profile || saving} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={!profile || saving}>{saving ? 'Saving…' : 'Save profile'}</Button>
          {message && <p className="text-sm text-text" role="status">{message}</p>}
        </div>
      </form>
    </Card>
  );
}
