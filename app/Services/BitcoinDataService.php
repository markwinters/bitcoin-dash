<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class BitcoinDataService
{
    public const HALVING_INTERVAL = 210_000;

    /**
     * Chart-ranges gemapt op Coinbase candle-granulariteit (seconden) en aantal candles.
     *
     * @var array<string, array{granularity: int, points: int}>
     */
    public const RANGES = [
        '1d' => ['granularity' => 300, 'points' => 288],
        '7d' => ['granularity' => 3600, 'points' => 168],
        '30d' => ['granularity' => 21600, 'points' => 120],
        '1y' => ['granularity' => 86400, 'points' => 300],
    ];

    /**
     * Volledige snapshot voor het dashboard. Elke bron faalt los van de rest.
     */
    public function snapshot(): array
    {
        return [
            'market' => $this->market(),
            'network' => $this->network(),
            'sentiment' => $this->sentiment(),
            'sources' => [
                'price' => 'Coinbase Exchange',
                'market' => 'CoinGecko',
                'network' => 'mempool.space',
                'sentiment' => 'alternative.me',
            ],
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /**
     * Marktdata (prijs, marktkapitalisatie, volume, ATH, supply) via CoinGecko.
     */
    public function market(): ?array
    {
        return $this->remember('market', config('bitcoin.cache.market'), function () {
            $data = $this->client(config('bitcoin.coingecko_url'))
                ->withHeaders(array_filter(['x-cg-demo-api-key' => config('bitcoin.coingecko_key')]))
                ->get('/coins/bitcoin', [
                    'localization' => 'false',
                    'tickers' => 'false',
                    'community_data' => 'false',
                    'developer_data' => 'false',
                    'sparkline' => 'false',
                ])
                ->throw()
                ->json('market_data');

            $result = [
                'circulating_supply' => $data['circulating_supply'] ?? null,
                'max_supply' => $data['max_supply'] ?? 21_000_000,
                'market_cap_rank' => 1,
                'last_updated' => $data['last_updated'] ?? null,
            ];

            foreach (config('bitcoin.currencies') as $cur) {
                $result[$cur] = [
                    'price' => $data['current_price'][$cur] ?? null,
                    'market_cap' => $data['market_cap'][$cur] ?? null,
                    'volume_24h' => $data['total_volume'][$cur] ?? null,
                    'high_24h' => $data['high_24h'][$cur] ?? null,
                    'low_24h' => $data['low_24h'][$cur] ?? null,
                    'change_24h' => $data['price_change_percentage_24h_in_currency'][$cur] ?? null,
                    'change_7d' => $data['price_change_percentage_7d_in_currency'][$cur] ?? null,
                    'change_30d' => $data['price_change_percentage_30d_in_currency'][$cur] ?? null,
                    'change_1y' => $data['price_change_percentage_1y_in_currency'][$cur] ?? null,
                    'ath' => $data['ath'][$cur] ?? null,
                    'ath_date' => $data['ath_date'][$cur] ?? null,
                    'ath_change' => $data['ath_change_percentage'][$cur] ?? null,
                ];
            }

            return $result;
        });
    }

    /**
     * Netwerkdata (blokhoogte, fees, hashrate, difficulty, mempool) via mempool.space.
     */
    public function network(): ?array
    {
        return $this->remember('network', config('bitcoin.cache.network'), function () {
            $base = config('bitcoin.mempool_url');

            $responses = Http::pool(fn ($pool) => [
                $pool->as('height')->timeout(config('bitcoin.timeout'))->get("$base/blocks/tip/height"),
                $pool->as('fees')->timeout(config('bitcoin.timeout'))->get("$base/v1/fees/recommended"),
                $pool->as('difficulty')->timeout(config('bitcoin.timeout'))->get("$base/v1/difficulty-adjustment"),
                $pool->as('hashrate')->timeout(config('bitcoin.timeout'))->get("$base/v1/mining/hashrate/3d"),
                $pool->as('mempool')->timeout(config('bitcoin.timeout'))->get("$base/mempool"),
                $pool->as('blocks')->timeout(config('bitcoin.timeout'))->get("$base/v1/blocks"),
            ]);

            $ok = fn (string $key) => $responses[$key] instanceof \Illuminate\Http\Client\Response
                && $responses[$key]->successful();

            if (! $ok('height')) {
                throw new \RuntimeException('mempool.space: blokhoogte niet beschikbaar');
            }

            $height = (int) $responses['height']->body();
            $difficulty = $ok('difficulty') ? $responses['difficulty']->json() : [];
            $hashrate = $ok('hashrate') ? $responses['hashrate']->json() : [];
            $mempool = $ok('mempool') ? $responses['mempool']->json() : [];

            $blocks = $ok('blocks') ? collect($responses['blocks']->json())
                ->take(6)
                ->map(fn ($b) => [
                    'height' => $b['height'] ?? null,
                    'id' => $b['id'] ?? null,
                    'timestamp' => $b['timestamp'] ?? null,
                    'tx_count' => $b['tx_count'] ?? null,
                    'size' => $b['size'] ?? null,
                    'pool' => $b['extras']['pool']['name'] ?? null,
                ])->values()->all() : [];

            return [
                'height' => $height,
                'fees' => $ok('fees') ? $responses['fees']->json() : null,
                'difficulty' => [
                    'current' => $hashrate['currentDifficulty'] ?? null,
                    'progress' => $difficulty['progressPercent'] ?? null,
                    'change' => $difficulty['difficultyChange'] ?? null,
                    'remaining_blocks' => $difficulty['remainingBlocks'] ?? null,
                    'estimated_retarget' => $difficulty['estimatedRetargetDate'] ?? null,
                ],
                'hashrate' => $hashrate['currentHashrate'] ?? null,
                'mempool' => [
                    'count' => $mempool['count'] ?? null,
                    'vsize' => $mempool['vsize'] ?? null,
                    'total_fee' => $mempool['total_fee'] ?? null,
                ],
                'halving' => $this->halving($height),
                'blocks' => $blocks,
            ];
        });
    }

    /**
     * Crypto Fear & Greed index via alternative.me.
     */
    public function sentiment(): ?array
    {
        return $this->remember('sentiment', config('bitcoin.cache.sentiment'), function () {
            $item = $this->client(config('bitcoin.fear_greed_url'))
                ->get('', ['limit' => 1])
                ->throw()
                ->json('data.0');

            return [
                'value' => isset($item['value']) ? (int) $item['value'] : null,
                'label' => $item['value_classification'] ?? null,
                'timestamp' => isset($item['timestamp']) ? (int) $item['timestamp'] : null,
            ];
        });
    }

    /**
     * Historische koersdata via Coinbase Exchange candles.
     *
     * @return array<int, array{t: int, o: float, h: float, l: float, c: float, v: float}>|null
     */
    public function chart(string $range = '1d', string $currency = 'usd'): ?array
    {
        $range = array_key_exists($range, self::RANGES) ? $range : '1d';
        $currency = in_array($currency, config('bitcoin.currencies'), true) ? $currency : 'usd';
        $spec = self::RANGES[$range];

        return $this->remember("chart.$range.$currency", config('bitcoin.cache.chart'), function () use ($spec, $currency) {
            $end = now();
            $start = $end->copy()->subSeconds($spec['granularity'] * $spec['points']);

            $candles = $this->client(config('bitcoin.coinbase_url'))
                ->get('/products/BTC-'.strtoupper($currency).'/candles', [
                    'granularity' => $spec['granularity'],
                    'start' => $start->toIso8601String(),
                    'end' => $end->toIso8601String(),
                ])
                ->throw()
                ->json();

            // Coinbase: [time, low, high, open, close, volume], nieuwste eerst.
            return collect($candles)
                ->map(fn ($c) => [
                    't' => (int) $c[0],
                    'l' => (float) $c[1],
                    'h' => (float) $c[2],
                    'o' => (float) $c[3],
                    'c' => (float) $c[4],
                    'v' => (float) $c[5],
                ])
                ->sortBy('t')
                ->values()
                ->all();
        });
    }

    /**
     * Halving-info op basis van de blokhoogte (gemiddeld 10 minuten per blok).
     */
    public function halving(int $height): array
    {
        $epoch = intdiv($height, self::HALVING_INTERVAL);
        $next = ($epoch + 1) * self::HALVING_INTERVAL;
        $remaining = $next - $height;

        return [
            'next_height' => $next,
            'remaining_blocks' => $remaining,
            'progress' => round((($height % self::HALVING_INTERVAL) / self::HALVING_INTERVAL) * 100, 2),
            'estimated_date' => now()->addMinutes($remaining * 10)->toIso8601String(),
            'subsidy' => 50 / (2 ** $epoch),
            'next_subsidy' => 50 / (2 ** ($epoch + 1)),
        ];
    }

    private function client(string $baseUrl): PendingRequest
    {
        return Http::baseUrl($baseUrl)
            ->acceptJson()
            ->withUserAgent('BitcoinHoloDash/1.0 (+Laravel)')
            ->timeout(config('bitcoin.timeout'))
            ->retry(2, 250, throw: false);
    }

    /**
     * Cache een succesvol resultaat. Bij een fout wordt de laatst bekende waarde
     * teruggegeven (stale-while-error), zodat het dashboard niet leeg valt.
     */
    private function remember(string $key, int $ttl, callable $callback): ?array
    {
        $fresh = "bitcoin.$key";
        $stale = "bitcoin.$key.stale";

        if (($cached = Cache::get($fresh)) !== null) {
            return $cached;
        }

        try {
            $value = $callback();
            Cache::put($fresh, $value, $ttl);
            Cache::put($stale, $value, now()->addDay());

            return $value;
        } catch (Throwable $e) {
            Log::warning("Bitcoin data [$key] ophalen mislukt: {$e->getMessage()}");

            return Cache::get($stale);
        }
    }
}
