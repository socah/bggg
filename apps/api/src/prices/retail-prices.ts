import { PriceOffer } from './price-analysis';

export interface Attribution { name: string; url: string; logo: string }

interface RetailResponse {
  currency?: string;
  sitename?: string;
  url?: string;
  logo?: string;
  items?: Array<{
    external_id: string | number;
    name: string;
    versions?: { lang?: string[] };
    prices?: Array<{
      price: number | string; product: number | string; shipping: number | string;
      shipping_known: boolean; stock: string; country: string; link: string;
    }>;
  }>;
}

export function parseRetailPrices(data: RetailResponse, bggId: number): { offers: PriceOffer[]; attribution: Attribution } {
  if (data.currency !== 'EUR' || !Array.isArray(data.items)) throw new Error('Invalid BoardGamePrices response');
  const offers = data.items.filter((item) => Number(item.external_id) === bggId).flatMap((item) =>
    (item.prices ?? []).flatMap((offer) => {
      const price = Number(offer.price);
      const product = Number(offer.product);
      const shipping = Number(offer.shipping);
      // Unknown shipping is not a delivered price, and preorders are not buy-now.
      if (offer.stock !== 'Y' || offer.shipping_known !== true ||
        !Number.isFinite(price) || price <= 0 || !Number.isFinite(product) || product <= 0 ||
        !Number.isFinite(shipping) || shipping < 0 ||
        !/^https:\/\/boardgameprices\.co\.uk\//i.test(offer.link)) return [];
      return [{ price: Math.round(price * 100) / 100, product, shipping, url: offer.link,
        label: item.name, country: offer.country, language: item.versions?.lang?.join(', ') }];
    }));
  return { offers, attribution: {
    name: data.sitename ?? 'BoardGamePrices.co.uk',
    url: /^https:\/\/boardgameprices\.co\.uk(?:\/|$)/i.test(data.url ?? '') ? data.url! : 'https://boardgameprices.co.uk',
    logo: /^https:\/\/boardgameprices\.co\.uk\//i.test(data.logo ?? '') ? data.logo! : 'https://boardgameprices.co.uk/img/meeple-logo-GB.png',
  } };
}
