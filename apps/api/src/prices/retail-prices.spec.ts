import { parseRetailPrices } from './retail-prices';

describe('BoardGamePrices normalization', () => {
  it('selects only in-stock EUR totals with known shipping for the requested game', () => {
    const base = { price: '30.99', product: '25', shipping: '5.99', shipping_known: true, stock: 'Y', country: 'GR', link: 'https://boardgameprices.co.uk/item/go?source=A' };
    const data = { currency: 'EUR', items: [
      { external_id: '101', name: 'Game', versions: { lang: ['GB'] }, prices: [base,
        { ...base, stock: 'N', price: 10 }, { ...base, stock: 'P' },
        { ...base, shipping_known: false, price: 20 }, { ...base, price: 'NaN' }] },
      { external_id: '102', name: 'Wrong game', prices: [base] },
    ] };
    const result = parseRetailPrices(data, 101);
    expect(result.offers).toEqual([{ price: 30.99, product: 25, shipping: 5.99, url: base.link, label: 'Game', country: 'GR', language: 'GB' }]);
    expect(result.attribution.name).toBe('BoardGamePrices.co.uk');
  });

  it('does not mistake malformed or wrong-currency responses for a sold-out day', () => {
    expect(() => parseRetailPrices({ currency: 'GBP', items: [] }, 1)).toThrow();
    expect(() => parseRetailPrices({ currency: 'EUR' }, 1)).toThrow();
    expect(parseRetailPrices({ currency: 'EUR', items: [] }, 1).offers).toEqual([]);
  });
});
