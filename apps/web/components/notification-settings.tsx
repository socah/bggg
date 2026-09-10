'use client';

import { useEffect, useState } from 'react';
import { apiFetch, apiMutate } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface Preferences {
  chatMessages: boolean;
  proposalUpdates: boolean;
  showMessagePreviews: boolean;
}

interface Configuration {
  enabled: boolean;
  publicKey: string | null;
}

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const decoded = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function subscriptionBody(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  };
}

export function NotificationSettings() {
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch('/notifications/configuration').then((response) => response.json() as Promise<Configuration>),
      apiFetch('/notifications/preferences').then((response) => response.json() as Promise<Preferences>),
      supported ? navigator.serviceWorker.getRegistration().then((registration) => registration?.pushManager.getSubscription() ?? null) : Promise.resolve(null),
    ]).then(([nextConfiguration, nextPreferences, nextSubscription]) => {
      if (cancelled) return;
      setConfiguration(nextConfiguration);
      setPreferences(nextPreferences);
      setSubscription(nextSubscription);
      if (supported) setPermission(Notification.permission);
      if (supported && !nextSubscription) {
        void navigator.serviceWorker.ready
          .then((registration) => registration.pushManager.getSubscription())
          .then((readySubscription) => { if (!cancelled) setSubscription(readySubscription); });
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load notification settings');
    });
    return () => { cancelled = true; };
  }, [supported]);

  async function enableNotifications() {
    if (!configuration?.publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== 'granted') return;
      const registration = await navigator.serviceWorker.ready;
      const nextSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(configuration.publicKey),
      });
      await apiMutate('/notifications/subscriptions', 'POST', subscriptionBody(nextSubscription));
      setSubscription(nextSubscription);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not enable notifications');
    } finally {
      setBusy(false);
    }
  }

  async function disableNotifications() {
    if (!subscription) return;
    setBusy(true);
    setError(null);
    try {
      await apiMutate('/notifications/subscriptions', 'DELETE', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
      setSubscription(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disable notifications');
    } finally {
      setBusy(false);
    }
  }

  async function updatePreference(name: keyof Preferences, checked: boolean) {
    if (!preferences) return;
    const previous = preferences;
    setPreferences({ ...preferences, [name]: checked });
    setError(null);
    try {
      const response = await apiMutate('/notifications/preferences', 'PATCH', { [name]: checked });
      setPreferences(await response.json());
    } catch (cause) {
      setPreferences(previous);
      setError(cause instanceof Error ? cause.message : 'Could not save notification settings');
    }
  }

  if (!supported) return <p className="text-sm text-text-muted">System notifications are not supported by this browser.</p>;
  if (!configuration || !preferences) return <p className="text-sm text-text-muted">Loading notification settings...</p>;
  if (!configuration.enabled) return <p className="text-sm text-text-muted">System notifications are not configured on this server.</p>;

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        {subscription ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={disableNotifications}>Disable on this device</Button>
        ) : (
          <Button type="button" disabled={busy || permission === 'denied'} onClick={enableNotifications}>Enable on this device</Button>
        )}
        <span className="text-sm text-text-muted">
          {subscription ? 'Notifications are enabled.' : permission === 'denied' ? 'Permission is blocked in browser settings.' : 'Notifications are off on this device.'}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <PreferenceCheckbox checked={preferences.chatMessages} label="Chat messages" onChange={(checked) => updatePreference('chatMessages', checked)} />
        <PreferenceCheckbox checked={preferences.proposalUpdates} label="Proposal updates" onChange={(checked) => updatePreference('proposalUpdates', checked)} />
        <PreferenceCheckbox checked={preferences.showMessagePreviews} label="Show chat message previews" onChange={(checked) => updatePreference('showMessagePreviews', checked)} />
      </div>
      {error && <p role="alert" className="text-sm text-accent">{error}</p>}
    </div>
  );
}

function PreferenceCheckbox({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
      <input className="size-5 accent-accent" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
