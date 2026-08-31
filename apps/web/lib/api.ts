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

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.accessToken}`);

  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
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

// Thrown by apiMutate for any non-ok response. NestJS error bodies look
// like { statusCode, message, error } — message is the human-readable part
// (e.g. 'RSVPs are closed once confirmation has been requested') and is
// what components surface inline.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Mutation funnel for scheduling (Approach A: plain fetch + refetch —
// deliberately NOT a data-fetching library; if caching or optimistic
// updates are ever needed, TanStack Query wraps around these same paths
// without backend changes).
//
// Throws ApiError on !ok so callers render `err.message` directly; returns
// the raw Response otherwise (callers read JSON themselves when they need
// the created/updated resource back).
export async function apiMutate(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<Response> {
  const response = await apiFetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      if (typeof data?.message === 'string') message = data.message;
      else if (Array.isArray(data?.message)) message = data.message.join('; ');
    } catch {
      // Non-JSON error body — statusText is the best we have.
    }
    throw new ApiError(message, response.status);
  }

  return response;
}
