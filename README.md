# The Amazing Bitcoin — Holo Dashboard

Een realtime Bitcoin-dashboard als one-pager, in holografische Marvel-comicstijl
(foil-randen, halftone, POW!-bursts, speech bubbles). Puur statisch: HTML, CSS en
JavaScript, zonder build-stap, server of API-keys.

## Databronnen

Alleen publieke API's zonder key; de browser haalt alles rechtstreeks op.

| Wat | Bron | Hoe |
| --- | --- | --- |
| Live koers, bid/ask, 24u range, live trades | [Coinbase Exchange](https://docs.cdp.coinbase.com/exchange/websocket-feed/overview) | WebSocket (`ticker`, BTC-EUR + BTC-USD) |
| Koersgrafiek (24U / 7D / 30D / 1J) | Coinbase Exchange candles | REST, met CoinGecko als reserve |
| Marktkapitalisatie, volume, ATH, supply, performance | [CoinGecko](https://www.coingecko.com) | REST, elke 30 s |
| Blokhoogte, nieuwe blokken, fees, mempool, hashrate, difficulty | [mempool.space](https://mempool.space) | REST + WebSocket voor nieuwe blokken |
| Fear & Greed index | [alternative.me](https://alternative.me/crypto/fear-and-greed-index/) | REST |

Valt een bron weg, dan blijft de laatst bekende waarde staan. Valt de WebSocket weg,
dan verbindt de pagina automatisch opnieuw.

## Bestanden

```
index.html          de pagina
css/dashboard.css   holo/comic-stijl
js/data.js          ophalen en omzetten van de REST-bronnen
js/dashboard.js     rendering, WebSockets, grafiek, effecten
```

## Lokaal bekijken

Open `index.html` in je browser, of start een lokale server:

```bash
npx serve .
# of: python3 -m http.server
```

## Publiceren op GitHub Pages

**Settings → Pages → Build and deployment → Source: Deploy from a branch**,
kies `main` en `/ (root)`. Het dashboard staat dan op
`https://<gebruiker>.github.io/bitcoin-dash/`.
