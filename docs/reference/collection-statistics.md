# Private collection statistics

The personal `/profile` page displays collection growth, recorded acquisition value,
and an estimated second-hand market value. The authenticated endpoint is
`GET /bgg-account/collection-stats`; ownership and acquisition data are always scoped
to the token's subject. These statistics are not exposed on other members' profiles.

## Growth and recorded value

- Only games currently in `game_ownership` count, not wishlisted, saved, or custom-list games.
- Monthly growth uses the private **Date acquired** when present, otherwise the
  ownership row's `added_at` date. The UI reports how many dates use that fallback.
- The chart reconstructs acquisitions of the current collection. It does not
  reconstruct sold/removed games or past collection snapshots.
- Recorded acquisition value sums private **Amount paid (EUR)** values. Zero is a
  recorded price; missing values are excluded and coverage is displayed.

## Estimated market value

For each owned game:

1. Find the cheapest eligible EUR GeekMarket listing, using the same accessory,
   outlier, historical-reference, and manual-exclusion filters as the price panel.
2. Compare it with the cheapest available retail offer tracked by the app
   (known delivery to Greece included).
3. If second-hand is higher than retail, use `retail × 0.75`. Also use this fallback
   when no eligible second-hand offer is available but retail is available.
4. Otherwise use the second-hand minimum. Marketplace shipping is not included.
5. Without either price, use the recorded acquisition value when available,
   including a recorded zero. Only games with none of these values are excluded
   from the estimated subtotal.

The UI displays market-price coverage, acquisition-fallback counts, stale-price
counts, and each game's valuation basis. Acquisition fallbacks are not marked as
stale marketplace prices.
Profile visits bulk-read cached prices; the existing daily collector tracks owned
games in the background. The totals are asking-price estimates, not sale proceeds.

## Incorrect listing reports

The **Flag incorrect listing** action calls
`POST /bgg-account/games/:gameId/prices/market-exclusions` with `{ "url": "..." }`.
The URL must belong to that game's known current or historical marketplace offers.
The authenticated action records a shared exclusion in `game_market_exclusions`.
Repeated reports are idempotent.

Exclusions are keyed by game and listing URL rather than price. They apply to
historical observations and future provider refreshes, without discarding other
listings. The API returns the recalculated price overview immediately. Collection
valuations are derived on every read, so they automatically use the corrected
minimum or retail fallback. The web UI refreshes mounted stats after a successful
report or private-details autosave, on window focus, or using its Refresh button.

## Database changes

Apply migrations using `make db-migrate` locally. Acquisition dates and marketplace
exclusions are introduced in `1791600100000-GameDateAcquired.ts` and
`1791600200000-GameMarketExclusions.ts`. Production deployment runs migrations before
starting the updated application.
