import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulingService } from './scheduling.service';
import { ProposalsController } from './proposals.controller';

const PROPOSAL_ID = 'proposal-1';
const fakeRequest = { user: { sub: 'user-1' } };

describe('ProposalsController', () => {
  let controller: ProposalsController;

  const mockSchedulingService = { removeProposal: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProposalsController],
      providers: [{ provide: SchedulingService, useValue: mockSchedulingService }],
    }).compile();

    controller = module.get<ProposalsController>(ProposalsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('exposes DELETE /proposals/:id as 204 and delegates with the authenticated user', async () => {
    type RemoveHandler = (
      id: string,
      req: typeof fakeRequest,
    ) => Promise<void>;
    const remove = (controller as unknown as { remove?: RemoveHandler }).remove;

    expect(remove).toBeDefined();
    if (!remove) return;

    expect(Reflect.getMetadata(PATH_METADATA, remove)).toBe(':id');
    expect(Reflect.getMetadata(METHOD_METADATA, remove)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, remove)).toBe(HttpStatus.NO_CONTENT);

    mockSchedulingService.removeProposal.mockResolvedValue(undefined);
    await remove.call(controller, PROPOSAL_ID, fakeRequest);

    expect(mockSchedulingService.removeProposal).toHaveBeenCalledWith(PROPOSAL_ID, 'user-1');
  });
});
