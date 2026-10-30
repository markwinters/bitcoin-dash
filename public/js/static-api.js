/* ==========================================================================
   Client-side variant van App\Services\BitcoinDataService voor de statische
   GitHub Pages-build (geen PHP). Haalt alles rechtstreeks uit de publieke
   API's (allemaal CORS-vriendelijk) en geeft hetzelfde formaat terug als
   /api/bitcoin en /api/bitcoin/chart.
   ========================================================================== */
(() => {
    'use strict';

    const COINGECKO = 'https://api.coingecko.com/api/v3';
    const COINBASE = 'https://api.exchange.coinbase.com';
    const MEMPOOL = 'https://mempool.space/api';
    const FNG = 'https://api.alternative.me/fng/?limit=1';
    const HALVING_INTERVAL = 210000;
    const CURRENCIES = ['usd', 'eur'];
    const RANGES = {
        '1d': { granularity: 300, points: 288, days: 1 },
        '7d': { granularity: 3600, points: 168, days: 7 },
        '30d': { granularity: 21600, points: 120, days: 30 },
        '1y': { granularity: 86400, points: 300, days: 365 },
    };

    const json = async (url, asText = false) => {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        return asText ? res.text() : res.json();
    };

    // Laatst bekende goede waarde per bron (stale-while-error), net als de Laravel-cache.
    const last = {};
    const remember = async (key, fn) => {
        try { return (last[key] = await fn()); } catch { return last[key] ?? null; }
    };

    async function market() {
        const d = (await json(`${COINGECKO}/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`)).market_data;
        const result = {
            circulating_supply: d.circulating_supply ?? null,
            max_supply: d.max_supply ?? 21000000,
            market_cap_rank: 1,
            last_updated: d.last_updated ?? null,
        };
        for (const cur of CURRENCIES) {
            result[cur] = {
                price: d.current_price?.[cur] ?? null,
                market_cap: d.market_cap?.[cur] ?? null,
                volume_24h: d.total_volume?.[cur] ?? null,
                high_24h: d.high_24h?.[cur] ?? null,
                low_24h: d.low_24h?.[cur] ?? null,
                change_24h: d.price_change_percentage_24h_in_currency?.[cur] ?? null,
                change_7d: d.price_change_percentage_7d_in_currency?.[cur] ?? null,
                change_30d: d.price_change_percentage_30d_in_currency?.[cur] ?? null,
                change_1y: d.price_change_percentage_1y_in_currency?.[cur] ?? null,
                ath: d.ath?.[cur] ?? null,
                ath_date: d.ath_date?.[cur] ?? null,
                ath_change: d.ath_change_percentage?.[cur] ?? null,
            };
        }
        return result;
    }

    function halving(height) {
        const epoch = Math.floor(height / HALVING_INTERVAL);
        const next = (epoch + 1) * HALVING_INTERVAL;
        const remaining = next - height;
        return {
            next_height: next,
            remaining_blocks: remaining,
            progress: Math.round(((height % HALVING_INTERVAL) / HALVING_INTERVAL) * 10000) / 100,
            estimated_date: new Date(Date.now() + remaining * 600000).toISOString(),
            subsidy: 50 / 2 ** epoch,
            next_subsidy: 50 / 2 ** (epoch + 1),
        };
    }

    async function network() {
        const [height, fees, difficulty, hashrate, mempool, blocks] = await Promise.allSettled([
            json(`${MEMPOOL}/blocks/tip/height`, true),
            json(`${MEMPOOL}/v1/fees/recommended`),
            json(`${MEMPOOL}/v1/difficulty-adjustment`),
            json(`${MEMPOOL}/v1/mining/hashrate/3d`),
            json(`${MEMPOOL}/mempool`),
            json(`${MEMPOOL}/v1/blocks`),
        ]);
        const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
        if (!ok(height)) throw new Error('mempool.space: blokhoogte niet beschikbaar');

        const h = parseInt(ok(height), 10);
        const da = ok(difficulty) ?? {};
        const hr = ok(hashrate) ?? {};
        const mp = ok(mempool) ?? {};

        return {
            height: h,
            fees: ok(fees),
            difficulty: {
                current: hr.currentDifficulty ?? null,
                progress: da.progressPercent ?? null,
                change: da.difficultyChange ?? null,
                remaining_blocks: da.remainingBlocks ?? null,
                estimated_retarget: da.estimatedRetargetDate ? new Date(da.estimatedRetargetDate).toISOString() : null,
            },
            hashrate: hr.currentHashrate ?? null,
            mempool: { count: mp.count ?? null, vsize: mp.vsize ?? null, total_fee: mp.total_fee ?? null },
            halving: halving(h),
            blocks: (ok(blocks) ?? []).slice(0, 6).map((b) => ({
                height: b.height ?? null,
                id: b.id ?? null,
                timestamp: b.timestamp ?? null,
                tx_count: b.tx_count ?? null,
                size: b.size ?? null,
                pool: b.extras?.pool?.name ?? null,
            })),
        };
    }

    async function sentiment() {
        const item = (await json(FNG)).data?.[0] ?? {};
        return {
            value: item.value != null ? parseInt(item.value, 10) : null,
            label: item.value_classification ?? null,
            timestamp: item.timestamp != null ? parseInt(item.timestamp, 10) : null,
        };
    }

    async function snapshot() {
        const [m, n, s] = await Promise.all([
            remember('market', market),
            remember('network', network),
            remember('sentiment', sentiment),
        ]);
        return {
            market: m,
            network: n,
            sentiment: s,
            sources: { price: 'Coinbase Exchange', market: 'CoinGecko', network: 'mempool.space', sentiment: 'alternative.me' },
            generated_at: new Date().toISOString(),
        };
    }

    async function chart(range = '1d', currency = 'usd') {
        const spec = RANGES[range] ?? RANGES['1d'];
        const end = new Date();
        const start = new Date(end - spec.granularity * spec.points * 1000);
        let candles;
        try {
            const rows = await json(`${COINBASE}/products/BTC-${currency.toUpperCase()}/candles?granularity=${spec.granularity}&start=${start.toISOString()}&end=${end.toISOString()}`);
            // Coinbase: [time, low, high, open, close, volume], nieuwste eerst.
            candles = rows.map((c) => ({ t: c[0], l: c[1], h: c[2], o: c[3], c: c[4], v: c[5] })).sort((a, b) => a.t - b.t);
        } catch {
            // Reserve: CoinGecko market_chart (alleen slotkoersen).
            const data = await json(`${COINGECKO}/coins/bitcoin/market_chart?vs_currency=${currency}&days=${spec.days}`);
            candles = (data.prices ?? []).map(([t, p]) => ({ t: Math.floor(t / 1000), o: p, h: p, l: p, c: p, v: 0 }));
        }
        return { range, currency, candles };
    }

    window.BTC_STATIC_API = { snapshot, chart };
})();
