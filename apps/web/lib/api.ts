'use client';

import { getSession } from 'next-auth/react';
import { logOut } from '@/lib/logout';

type ApiSession = Awaited<ReturnType<typeof getSession>>;
let recentSession: { value: ApiSession; expiresAt: number } | null = null;
let sessionRequest: Promise<ApiSession> | null = null;

async function getApiSession(): Promise<ApiSession> {
  if (recentSession && recentSession.expiresAt > Date.now()) return recentSession.value;
  sessionRequest ??= getSession().then((session) => {
    recentSession = { value: session, expiresAt: Date.now() + 1000 };
    return session;
  }).finally(() => { sessionRequest = null; });
  return sessionRequest;
}

// Every client-side call to apps/api goes through here — see
// docs/reference/authentication-keycloak.md's "Frontend calls to apps/api
// need the raw access token" section for why. Centralizing here is what
// keeps "expose the token to browser JS" a cheaply reversible decision: a
// future switch to a server-side proxy only changes this one file.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await getApiSession();

  if (!session || session.error === 'RefreshTokenError') {
    logOut();
    throw new Error('Session expired');
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.accessToken}`);

  let response = await fetch(`/api${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    recentSession = null;
    const refreshedSession = await getApiSession();
    if (refreshedSession && refreshedSession.error !== 'RefreshTokenError') {
      headers.set('Authorization', `Bearer ${refreshedSession.accessToken}`);
      response = await fetch(`/api${path}`, { ...init, headers });
    }
    if (response.status === 401) {
      logOut();
      throw new Error('Session expired');
    }
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
