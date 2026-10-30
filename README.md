# The Amazing Bitcoin — Holo Dashboard

Een realtime Bitcoin-dashboard als one-pager in Laravel, in holografische
Marvel-comicstijl (foil-randen, halftone, POW!-bursts, speech bubbles).

## Databronnen

| Wat | Bron | Hoe |
| --- | --- | --- |
| Live koers, bid/ask, 24u range, live trades | [Coinbase Exchange](https://docs.cdp.coinbase.com/exchange/websocket-feed/overview) | WebSocket in de browser (`ticker`-channel, BTC-EUR + BTC-USD) |
| Koersgrafiek (24U / 7D / 30D / 1J) | Coinbase Exchange candles | Laravel API, gecached |
| Marktkapitalisatie, volume, ATH, supply, performance | [CoinGecko](https://www.coingecko.com) | Laravel API, gecached |
| Blokhoogte, nieuwe blokken, fees, mempool, hashrate, difficulty | [mempool.space](https://mempool.space) | Laravel API + WebSocket voor nieuwe blokken |
| Fear & Greed index | [alternative.me](https://alternative.me/crypto/fear-and-greed-index/) | Laravel API, gecached |

Geen API-keys nodig. Valt een bron weg, dan toont het dashboard de laatst bekende
waarde (stale cache) en valt de live koers terug op polling van `/api/bitcoin`.

## Starten

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate   # cache/sessions tabellen (sqlite)
php artisan serve
```

Open http://localhost:8000.

## Endpoints

- `GET /` — het dashboard
- `GET /api/bitcoin` — gecombineerde snapshot (markt, netwerk, sentiment)
- `GET /api/bitcoin/chart?range=1d|7d|30d|1y&currency=eur|usd` — candles

## Configuratie

Zie `config/bitcoin.php`. Optioneel in `.env`:

```
COINGECKO_API_KEY=        # CoinGecko demo-key voor hogere rate limits
BITCOIN_CACHE_MARKET=60   # seconden
BITCOIN_CACHE_NETWORK=30
BITCOIN_CACHE_CHART=60
```

## Tests

```bash
php artisan test
```
