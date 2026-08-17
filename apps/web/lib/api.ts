'use client';

import { getSession, signOut } from 'next-auth/react';

// Every client-side call to apps/api goes through here — see
// docs/reference/authentication-keycloak.md's "Frontend calls to apps/api
// need the raw access token" section for why. Centralizing here is what
// keeps "expose the token to browser JS" a cheaply reversible decision: a
// future switch to a server-side proxy only changes this one file.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await getSession();

  if (!session || session.error === 'RefreshTokenError') {
    await signOut({ redirectTo: '/web/login' });
    throw new Error('Session expired');
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (response.status === 401) {
    // The proactive check above should catch a dead session before this
    // point — this is the backstop for the case it doesn't (e.g. Keycloak
    // revoked the session server-side).
    await signOut({ redirectTo: '/web/login' });
    throw new Error('Session expired');
  }

  return response;
}
