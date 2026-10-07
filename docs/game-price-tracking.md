# Game price tracking

The game info panel shows prices before reviews for wishlist games and after
reviews/plays for other games. Prices load independently of reviews.

## Providers

- BoardGamePrices `/api/info`: BGG ID (`eid`), EUR, destination GR, CHEAP1.
  Only in-stock offers with known shipping qualify for the buy-now total.
  Editions/languages are shown, and links go through the provider. Its supplied
  logo, site name and backlink are displayed as required by its API terms.
- BGG XML API2 `thing?marketplace=1`: uses the existing `BGG_API_TOKEN` and
  polling client. Only EUR listings qualify. The feed does **not** include
  seller country or shipping estimates. EUR is a market proxy, not verification
  that a seller is European or ships to Greece. Conditions can include unopened
  games and commercial sellers. These are asking prices, not sale prices.

Neither endpoint supplies historical observations. Listing creation dates do
not reconstruct what the market's cheapest available offer was on a past day.
History therefore begins with this application's observations.

## Tracking and caching

Apply migration `1791300000000-GamePrices` through the normal migration workflow
(`make db-migrate` in development). Set `BOARDGAMEPRICES_SITE_URL` to the public
application URL. Compose defaults it to the deployed domain; outside Compose
the service also falls back to `PUBLIC_APP_URL` / `AUTH_URL`.

`GET /bgg-account/games/:gameId/prices` requires authentication and returns both
sources, daily history (last year), and a bargain estimate. Opening a panel
refreshes prices if its persisted cache is older than one hour. PostgreSQL
advisory locks serialize refreshes across API replicas, including background
collection, to respect the provider's minimum one-hour cache requirement.

Every minute the API processes up to ten games due for their daily check:
owned games, wishlisted games and previously viewed/tracked games. Each game
is processed sequentially with a two-second pause between games. The collector
is stopped with the API and disabled under `NODE_ENV=test`. Tracking runs while
the API is running; missed days are left as gaps rather than fabricated.

There is one latest successful observation per UTC day/source/game. Provider
failures preserve the last successful offers and show a stale/unavailable
message; they do not create history points. Empty successful responses do
record days with no eligible offers. Source attempts, including failures, are
cached for an hour. History retains raw eligible offers so filtering can be
recomputed; UI shows raw and filtered daily minima and excluded counts.

## Bargain estimate

1. Remove listings explicitly describing accessories only or excluding the
   base game.
2. With at least four reference prices, remove the lower tail below
   `exp(median(log(price)) - max(log(2.5), 3 * 1.4826 * MAD(log(price))))`.
   Historical reference offers supplement sparse current listings. The minimum
   2.5x separation preserves ordinary discounts.
3. Take each observed day's cheapest remaining EUR asking price.
4. Require at least five daily observations spanning fourteen days in the last
   ninety days. Fit a Theil–Sen line (median pairwise slopes and median intercept)
   and evaluate it today. Suppress non-positive extrapolations.

The fitted price is a potential-bargain threshold, before second-hand shipping.
The estimator cannot perfectly identify accessories, incomplete copies, bundles
or edition/language differences. Review the linked listing before buying.
