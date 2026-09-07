import { Test, TestingModule } from '@nestjs/testing';
import { SchedulingService } from './scheduling.service';
import { HostingStatsController } from './hosting-stats.controller';

describe('HostingStatsController', () => {
  let controller: HostingStatsController;
  const schedulingService = {
    getMyHostingStats: jest.fn(),
    getGroupHostingStats: jest.fn(),
    getMemberHostingStats: jest.fn(),
  };
  const request = { user: { sub: 'user-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HostingStatsController],
      providers: [{ provide: SchedulingService, useValue: schedulingService }],
    }).compile();
    controller = module.get(HostingStatsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns hosting stats for the authenticated user', async () => {
    schedulingService.getMyHostingStats.mockResolvedValue({ hostedSessionCount: 3 });

    await expect(controller.getMyHostingStats(request)).resolves.toEqual({ hostedSessionCount: 3 });
    expect(schedulingService.getMyHostingStats).toHaveBeenCalledWith('user-1');
  });

  it('delegates group stats with the group and authenticated user ids', async () => {
    const stats = { totalSessionCount: 4, hosts: [] };
    schedulingService.getGroupHostingStats.mockResolvedValue(stats);

    await expect(controller.getGroupHostingStats('group-1', request)).resolves.toEqual(stats);
    expect(schedulingService.getGroupHostingStats).toHaveBeenCalledWith('group-1', 'user-1');
  });

  it('delegates member stats with the group, target, and authenticated user ids', async () => {
    schedulingService.getMemberHostingStats.mockResolvedValue({ hostedSessionCount: 2 });

    await expect(controller.getMemberHostingStats('group-1', 'user-2', request))
      .resolves.toEqual({ hostedSessionCount: 2 });
    expect(schedulingService.getMemberHostingStats).toHaveBeenCalledWith('group-1', 'user-2', 'user-1');
  });
});
