<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Databronnen
    |--------------------------------------------------------------------------
    |
    | Alle bronnen zijn publiek en hebben geen API-key nodig. Live prijzen
    | komen in de browser rechtstreeks via de Coinbase Exchange WebSocket;
    | deze endpoints worden server-side opgehaald en gecached.
    |
    */

    'coinbase_url' => env('BITCOIN_COINBASE_URL', 'https://api.exchange.coinbase.com'),
    'coingecko_url' => env('BITCOIN_COINGECKO_URL', 'https://api.coingecko.com/api/v3'),
    'mempool_url' => env('BITCOIN_MEMPOOL_URL', 'https://mempool.space/api'),
    'fear_greed_url' => env('BITCOIN_FEAR_GREED_URL', 'https://api.alternative.me/fng/'),

    // Optionele CoinGecko demo-key voor hogere rate limits.
    'coingecko_key' => env('COINGECKO_API_KEY'),

    // Cache-duur in seconden per soort data.
    'cache' => [
        'market' => (int) env('BITCOIN_CACHE_MARKET', 60),
        'network' => (int) env('BITCOIN_CACHE_NETWORK', 30),
        'chart' => (int) env('BITCOIN_CACHE_CHART', 60),
        'sentiment' => (int) env('BITCOIN_CACHE_SENTIMENT', 900),
    ],

    'timeout' => (int) env('BITCOIN_HTTP_TIMEOUT', 6),

    'currencies' => ['usd', 'eur'],

];
