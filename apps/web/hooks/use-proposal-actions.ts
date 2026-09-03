'use client';

import { useCallback, useState } from 'react';
import { ApiError, apiMutate } from '@/lib/api';
import type { RsvpInput } from '@/lib/types';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message === 'Session expired') return err.message;
  return 'Something went wrong — try again';
}

// One shared pending/error channel for every proposal mutation: only one
// action is ever in flight (buttons disable while pendingAction is set),
// and the failed action's message renders inline where the buttons live.
// Each action resolves even on failure — callers don't try/catch, they
// read `error`.
export function useProposalActions(onChanged?: () => void) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setPendingAction(key);
      setError(null);
      try {
        await action();
        onChanged?.();
      } catch (err) {
        setError(messageFor(err));
      } finally {
        setPendingAction(null);
      }
    },
    [onChanged],
  );

  const rsvp = useCallback(
    (proposalId: string, input: RsvpInput) =>
      run('rsvp', () => apiMutate(`/proposals/${proposalId}/rsvp`, 'PUT', input)),
    [run],
  );
  const lockIn = useCallback(
    (proposalId: string, confirmed: boolean) =>
      run('lock-in', () =>
        apiMutate(`/proposals/${proposalId}/rsvp/lock-in`, 'PATCH', { confirmed }),
      ),
    [run],
  );
  const requestConfirmation = useCallback(
    (proposalId: string) =>
      run('request-confirmation', () =>
        apiMutate(`/proposals/${proposalId}/request-confirmation`, 'POST'),
      ),
    [run],
  );
  const finalize = useCallback(
    (proposalId: string) => run('finalize', () => apiMutate(`/proposals/${proposalId}/finalize`, 'POST')),
    [run],
  );
  const undo = useCallback(
    (proposalId: string) => run('undo', () => apiMutate(`/proposals/${proposalId}/undo`, 'POST')),
    [run],
  );
  const cancel = useCallback(
    (proposalId: string) => run('cancel', () => apiMutate(`/proposals/${proposalId}/cancel`, 'POST')),
    [run],
  );
  const deleteProposal = useCallback(
    (proposalId: string) => run('delete', () => apiMutate(`/proposals/${proposalId}`, 'DELETE')),
    [run],
  );
  const setHost = useCallback(
    (proposalId: string, userId: string) =>
      run('set-host', () => apiMutate(`/proposals/${proposalId}/host`, 'PUT', { userId })),
    [run],
  );
  const clearHost = useCallback(
    (proposalId: string) =>
      run('clear-host', () => apiMutate(`/proposals/${proposalId}/host`, 'DELETE')),
    [run],
  );

  return {
    pendingAction,
    error,
    clearError: () => setError(null),
    rsvp,
    lockIn,
    requestConfirmation,
    finalize,
    undo,
    cancel,
    delete: deleteProposal,
    setHost,
    clearHost,
  };
}

export type ProposalActions = ReturnType<typeof useProposalActions>;
