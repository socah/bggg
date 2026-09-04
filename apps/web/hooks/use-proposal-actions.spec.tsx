import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import type { apiMutate as apiMutateType } from '@/lib/api';

const apiMutate = jest.fn<typeof apiMutateType>();

jest.unstable_mockModule('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
  apiMutate,
}));

const { ApiError } = await import('@/lib/api');
const { useProposalActions } = await import('./use-proposal-actions');

describe('useProposalActions', () => {
  it('runs proposal deletion through the shared pending, changed, and error channel', async () => {
    let resolveDelete!: (response: Response) => void;
    apiMutate.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const onChanged = jest.fn();
    const { result } = renderHook(() => useProposalActions(onChanged));
    const deleteProposal = (
      result.current as typeof result.current & { delete?: (proposalId: string) => Promise<void> }
    ).delete;

    expect(deleteProposal).toEqual(expect.any(Function));

    let deletion!: Promise<void>;
    act(() => {
      deletion = deleteProposal!('proposal-1');
    });
    expect(result.current.pendingAction).toBe('delete');
    expect(apiMutate).toHaveBeenCalledWith('/proposals/proposal-1', 'DELETE');

    await act(async () => {
      resolveDelete({} as Response);
      await deletion;
    });
    expect(result.current.pendingAction).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);

    apiMutate.mockRejectedValueOnce(new ApiError('Delete blocked', 409));
    await act(async () => {
      await deleteProposal!('proposal-1');
    });

    expect(result.current.error).toBe('Delete blocked');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
