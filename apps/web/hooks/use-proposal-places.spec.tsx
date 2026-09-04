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
      json: async () => path.endsWith('/available')
        ? [{ place: { id: 'place-1', name: 'Clubhouse' }, ownedByMe: true, suggestionCount: 4 }]
        : [{
            proposalPlaceId: 'proposal-place-1',
            place: { id: 'place-1', name: 'Clubhouse' },
            voteCount: 2,
            votedByMe: false,
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
});
