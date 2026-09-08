import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { apiFetch as apiFetchType, apiMutate as apiMutateType } from '@/lib/api';

const apiFetch = jest.fn<typeof apiFetchType>();
const apiMutate = jest.fn<typeof apiMutateType>();

jest.unstable_mockModule('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiFetch,
  apiMutate,
}));

const { useProposalPlaces } = await import('./use-proposal-places');

describe('useProposalPlaces', () => {
  it('loads places and changes ownership through the proposal-scoped endpoint', async () => {
    apiFetch.mockImplementation(async (path) => ({
      ok: true,
      json: async () => path === '/places/saved'
        ? [{ place: { id: 'place-1', name: 'Clubhouse' }, ownedByMe: true, suggestionCount: 4 }]
        : [{
            proposalPlaceId: 'proposal-place-1',
            place: { id: 'place-1', name: 'Clubhouse' },
            voteCount: 2,
            votedByMe: false,
            downvotedByMe: false,
            proposedByMe: true,
            ownedByMe: true,
            ownerIds: ['user-1'],
          }],
    }) as Response);
    apiMutate.mockResolvedValue({ ok: true } as Response);
    const onChanged = jest.fn();
    const { result } = renderHook(() => useProposalPlaces('proposal-1', onChanged));

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.available[0]?.place.name).toBe('Clubhouse');

    await act(async () => {
      await result.current.setOwned('proposal-place-1', false);
    });

    expect(apiMutate).toHaveBeenCalledWith(
      '/proposals/proposal-1/places/proposal-place-1/ownership',
      'DELETE',
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('downvotes and removes places through the matching endpoints', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] } as Response);
    apiMutate.mockResolvedValue({ ok: true } as Response);
    const { result } = renderHook(() => useProposalPlaces('proposal-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.downvote('proposal-place-1');
      await result.current.removeSuggestion('proposal-place-1');
      await result.current.removeSaved('place-1');
    });

    expect(apiMutate).toHaveBeenCalledWith('/proposals/proposal-1/places/proposal-place-1/downvotes', 'POST');
    expect(apiMutate).toHaveBeenCalledWith('/proposals/proposal-1/places/proposal-place-1', 'DELETE');
    expect(apiMutate).toHaveBeenCalledWith('/places/place-1/saved', 'DELETE');
  });
});
