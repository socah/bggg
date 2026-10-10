import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertGamePrivateDetailsDto } from './upsert-game-private-details.dto';

describe('UpsertGamePrivateDetailsDto', () => {
  it.each([-1, 1.234, 10000000000, '20', Infinity])('rejects invalid amount %s', async (amountPaid) => {
    const errors = await validate(plainToInstance(UpsertGamePrivateDetailsDto, { amountPaid }));
    expect(errors.some((error) => error.property === 'amountPaid')).toBe(true);
  });

  it.each([0, 39.95, null])('accepts amount %s', async (amountPaid) => {
    expect(await validate(plainToInstance(UpsertGamePrivateDetailsDto, { amountPaid }))).toEqual([]);
  });

  it('rejects oversized comments', async () => {
    const errors = await validate(plainToInstance(UpsertGamePrivateDetailsDto, { comment: 'a'.repeat(5001) }));
    expect(errors.some((error) => error.property === 'comment')).toBe(true);
  });

  it.each(['2026-02-30', '2026-13-01', 'October 10', '2026-10-10T12:00:00Z'])('rejects invalid acquisition date %s', async (dateAcquired) => {
    const errors = await validate(plainToInstance(UpsertGamePrivateDetailsDto, { dateAcquired }));
    expect(errors.some((error) => error.property === 'dateAcquired')).toBe(true);
  });

  it.each(['2026-10-10', '2024-02-29', null])('accepts acquisition date %s', async (dateAcquired) => {
    expect(await validate(plainToInstance(UpsertGamePrivateDetailsDto, { dateAcquired }))).toEqual([]);
  });
});
