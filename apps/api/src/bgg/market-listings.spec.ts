import { parseMarketListings } from './market-listings';

describe('GeekMarket XML feed', () => {
  it('parses the actual marketplacelistings wrapper and keeps currency, condition and notes', () => {
    const xml = `<items><item id="101"><marketplacelistings><listing>
      <price currency="EUR" value="30.50"/><condition value="verygood"/>
      <notes value="Complete &amp; sleeved"/><link href="https://boardgamegeek.com/market/product/123"/>
      </listing></marketplacelistings></item></items>`;
    expect(parseMarketListings(xml, 101)).toEqual([{ price: 30.5, currency: 'EUR', condition: 'verygood', notes: 'Complete & sleeved', url: 'https://boardgamegeek.com/market/product/123' }]);
  });

  it('handles empty markets and rejects unexpected responses', () => {
    expect(parseMarketListings('<items><item id="101"/></items>', 101)).toEqual([]);
    expect(() => parseMarketListings('<errors><error/></errors>', 101)).toThrow();
    expect(() => parseMarketListings('<items>', 101)).toThrow();
  });
});
