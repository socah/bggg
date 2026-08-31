import { getMetadataArgsStorage } from 'typeorm';
import { Game } from './game.entity';

describe('Game entity', () => {
  it('converts PostgreSQL numeric ratings to numbers when loading rows', () => {
    const ratingColumn = getMetadataArgsStorage().columns.find(
      (column) => column.target === Game && column.propertyName === 'rating',
    );
    const transformer = ratingColumn?.options.transformer as {
      from(value: string): number;
    };

    expect(transformer.from('8.79')).toBe(8.79);
  });
});
