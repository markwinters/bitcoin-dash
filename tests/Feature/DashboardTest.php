<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['cache.default' => 'array']);
        Cache::flush();
    }

    private function fakeSources(): void
    {
        Http::fake([
            'api.coingecko.com/*' => Http::response(['market_data' => [
                'current_price' => ['usd' => 100000, 'eur' => 92000],
                'market_cap' => ['usd' => 2.0e12, 'eur' => 1.8e12],
                'total_volume' => ['usd' => 3.0e10, 'eur' => 2.8e10],
                'high_24h' => ['usd' => 101000, 'eur' => 93000],
                'low_24h' => ['usd' => 98000, 'eur' => 90000],
                'price_change_percentage_24h_in_currency' => ['usd' => 1.5, 'eur' => 1.4],
                'ath' => ['usd' => 126000, 'eur' => 108000],
                'ath_date' => ['usd' => '2025-10-06T00:00:00Z', 'eur' => '2025-10-06T00:00:00Z'],
                'circulating_supply' => 19950000,
                'max_supply' => 21000000,
            ]]),
            'mempool.space/api/blocks/tip/height' => Http::response('920000'),
            'mempool.space/api/v1/fees/recommended' => Http::response(['fastestFee' => 8, 'halfHourFee' => 5, 'hourFee' => 3, 'economyFee' => 2, 'minimumFee' => 1]),
            'mempool.space/api/v1/difficulty-adjustment' => Http::response(['progressPercent' => 40.5, 'difficultyChange' => 2.1, 'remainingBlocks' => 1200, 'estimatedRetargetDate' => 1793000000000]),
            'mempool.space/api/v1/mining/hashrate/3d' => Http::response(['currentHashrate' => 1.1e21, 'currentDifficulty' => 1.5e14]),
            'mempool.space/api/mempool' => Http::response(['count' => 4200, 'vsize' => 2500000, 'total_fee' => 1000000]),
            'mempool.space/api/v1/blocks' => Http::response([
                ['id' => 'abc', 'height' => 920000, 'timestamp' => 1793000000, 'tx_count' => 3000, 'size' => 1600000, 'extras' => ['pool' => ['name' => 'Foundry USA']]],
            ]),
            'api.alternative.me/*' => Http::response(['data' => [['value' => '72', 'value_classification' => 'Greed', 'timestamp' => '1793000000']]]),
            'api.exchange.coinbase.com/*' => Http::response([
                [1793000600, 99000, 99500, 99100, 99400, 12.5],
                [1793000300, 98800, 99200, 98900, 99100, 10.1],
            ]),
        ]);
    }

    public function test_dashboard_page_renders(): void
    {
        $this->fakeSources();

        $this->get('/')
            ->assertOk()
            ->assertSee('The Amazing', false)
            ->assertSee('BTC_CONFIG', false);
    }

    public function test_snapshot_endpoint_combines_sources(): void
    {
        $this->fakeSources();

        $this->getJson('/api/bitcoin')
            ->assertOk()
            ->assertJsonPath('market.usd.price', 100000)
            ->assertJsonPath('market.eur.price', 92000)
            ->assertJsonPath('network.height', 920000)
            ->assertJsonPath('network.fees.fastestFee', 8)
            ->assertJsonPath('network.blocks.0.pool', 'Foundry USA')
            ->assertJsonPath('network.halving.next_height', 1050000)
            ->assertJsonPath('network.halving.remaining_blocks', 130000)
            ->assertJsonPath('sentiment.value', 72);
    }

    public function test_chart_endpoint_returns_sorted_candles(): void
    {
        $this->fakeSources();

        $this->getJson('/api/bitcoin/chart?range=1d&currency=eur')
            ->assertOk()
            ->assertJsonPath('currency', 'eur')
            ->assertJsonPath('candles.0.t', 1793000300)
            ->assertJsonPath('candles.1.c', 99400);

        Http::assertSent(fn ($request) => str_contains($request->url(), '/products/BTC-EUR/candles'));
    }

    public function test_chart_endpoint_validates_range(): void
    {
        $this->getJson('/api/bitcoin/chart?range=forever')->assertUnprocessable();
    }

    public function test_falls_back_to_stale_data_when_source_fails(): void
    {
        $this->fakeSources();
        $this->getJson('/api/bitcoin')->assertJsonPath('market.usd.price', 100000);

        Cache::forget('bitcoin.market');
        Http::swap(new HttpFactory);
        Http::fake(['*' => Http::response('boom', 500)]);

        $this->getJson('/api/bitcoin')
            ->assertOk()
            ->assertJsonPath('market.usd.price', 100000);

        Http::assertSent(fn ($request) => str_contains($request->url(), 'coingecko'));
    }

    public function test_page_survives_all_sources_down(): void
    {
        Http::fake(['*' => Http::response('boom', 500)]);

        $this->get('/')->assertOk();
        $this->getJson('/api/bitcoin')->assertOk()->assertJsonPath('market', null);
        $this->getJson('/api/bitcoin/chart')->assertStatus(503);
    }
}
