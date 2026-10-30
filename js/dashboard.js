/* ==========================================================================
   Bitcoin Dashboard — ZwolseCode
   - Live koers + trades: Coinbase Exchange WebSocket (ticker channel)
   - Nieuwe blokken + fees: mempool.space WebSocket
   - Markt/netwerk-snapshot + grafiek: publieke API's via data.js
   ========================================================================== */
(() => {
    'use strict';

    const api = window.BTC_API; // zie data.js
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const storage = {
        get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch { /* privé-modus */ } },
    };

    const state = {
        currency: storage.get('btc.currency', 'eur'),
        range: storage.get('btc.range', '1d'),
        snapshot: null,
        live: { usd: null, eur: null }, // laatste Coinbase ticker per valuta
        candles: [],
        wsConnected: false,
    };
    if (!['usd', 'eur'].includes(state.currency)) state.currency = 'eur';
    if (!['1d', '7d', '30d', '1y'].includes(state.range)) state.range = '1d';

    /* ---------- Iconen (ZwolseCode-set, lijn 1,5px op 24px-raster) ---------- */

    const ICONS = {
        'zap': ['M13 2.75 4.75 13.25h6.5l-1 8 8.5-10.5h-6.5l.75-8Z'],
        'code': ['m8 7.5-4.5 4.5L8 16.5M16 7.5l4.5 4.5-4.5 4.5M13.75 4.5l-3.5 15'],
        'lock': ['M12 2.75 20 7.375v9.25L12 21.25l-8-4.625v-9.25Z', 'M9.25 11.25h5.5c.41 0 .75.34.75.75v3.5c0 .41-.34.75-.75.75h-5.5a.75.75 0 0 1-.75-.75V12c0-.41.34-.75.75-.75ZM10.25 11.25v-1a1.75 1.75 0 0 1 3.5 0v1'],
        'shield': ['M12 2.75 19.25 5.5v5.75c0 4.4-3 8.1-7.25 9.75-4.25-1.65-7.25-5.35-7.25-9.75V5.5Z'],
        'cube': ['M12 2.75 20 7.375v9.25L12 21.25l-8-4.625v-9.25Z', 'M4 7.375 12 12l8-4.625M12 12v9.25M4 16.625 12 12l8 4.625'],
        'trend-up': ['m3.5 17 6-6 4 4L20.5 8', 'M14.5 8h6v6'],
        'future': ['M5.5 16.5 18 4M10 4h8v8M4 20.25h16'],
        'arrow-up-right': ['M7 17 17 7M8.5 7H17v8.5'],
        'arrow-right': ['M4.5 12h15M13.5 6l6 6-6 6'],
    };
    const PLAIN = new Set(['arrow-up-right', 'arrow-right']); // pijlen nemen de tekstkleur over

    function renderIcons() {
        $$('[data-icon]').forEach((el, i) => {
            const name = el.dataset.icon;
            const size = el.dataset.size || 32;
            const grad = !PLAIN.has(name);
            const id = `zc-icon-${i}`;
            el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${grad ? `url(#${id})` : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                ${grad ? `<defs><linearGradient id="${id}" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse"><stop offset="0" style="stop-color:var(--icon-start)"/><stop offset="1" style="stop-color:var(--icon-end)"/></linearGradient></defs>` : ''}
                ${ICONS[name].map((d) => `<path d="${d}"/>`).join('')}</svg>`;
        });
    }

    /* ---------- Formatters ---------- */

    const fmtCache = new Map();
    const nf = (opts) => {
        const key = JSON.stringify(opts);
        if (!fmtCache.has(key)) fmtCache.set(key, new Intl.NumberFormat('nl-NL', opts));
        return fmtCache.get(key);
    };
    const money = (v, digits = 2) => v == null ? '—' : nf({ style: 'currency', currency: state.currency.toUpperCase(), currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    const compactMoney = (v) => v == null ? '—' : nf({ style: 'currency', currency: state.currency.toUpperCase(), currencyDisplay: 'narrowSymbol', notation: 'compact', maximumFractionDigits: 2 }).format(v);
    const num = (v, digits = 0) => v == null ? '—' : nf({ maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
    const pct = (v, digits = 2) => v == null ? '—' : `${v > 0 ? '+' : ''}${nf({ maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)}%`;
    const trend = (v) => v == null ? '' : v >= 0 ? 'up' : 'down';
    const hashrate = (h) => {
        if (h == null) return '—';
        const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s', 'ZH/s'];
        let i = 0;
        while (h >= 1000 && i < units.length - 1) { h /= 1000; i++; }
        return `${num(h, 1)} ${units[i]}`;
    };
    const date = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => iso ? new Date(iso).toLocaleDateString('nl-NL', opts) : '—';
    const ago = (ts) => {
        const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
        if (s < 60) return `${s} s geleden`;
        if (s < 3600) return `${Math.floor(s / 60)} min geleden`;
        return `${Math.floor(s / 3600)} uur geleden`;
    };
    const setText = (id, text) => { const el = document.getElementById(id); if (el && el.textContent !== text) el.textContent = text; };
    const setTrend = (el, v) => { el.classList.remove('up', 'down'); const t = trend(v); if (t) el.classList.add(t); };
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    /* ---------- Afgeleide waarden ---------- */

    const market = () => state.snapshot?.market?.[state.currency] ?? null;
    const livePrice = () => state.live[state.currency]?.price ?? market()?.price ?? null;

    function liveChange24h() {
        const t = state.live[state.currency];
        if (t?.open24h) return ((t.price - t.open24h) / t.open24h) * 100;
        return market()?.change_24h ?? null;
    }

    /* ---------- Rendering ---------- */

    let prevRendered = null;
    let tickTimer;

    function renderPrice() {
        const price = livePrice();
        const t = state.live[state.currency];
        const m = market();
        const el = $('#price');

        setText('price', money(price));
        document.title = price ? `${money(price, 0)} — Bitcoin Dashboard — ZwolseCode` : 'Bitcoin Dashboard — ZwolseCode';

        // Korte kleurpuls bij een nieuwe tick: blauw omhoog, grijs omlaag.
        if (prevRendered != null && price != null && price !== prevRendered && !reducedMotion) {
            el.classList.remove('tick-up', 'tick-down');
            el.classList.add(price > prevRendered ? 'tick-up' : 'tick-down');
            clearTimeout(tickTimer);
            tickTimer = setTimeout(() => el.classList.remove('tick-up', 'tick-down'), 250);
        }
        prevRendered = price;

        const change = liveChange24h();
        const badge = $('#change-24h');
        badge.textContent = `${pct(change)} 24U`;
        setTrend(badge, change);

        setText('bid', t?.bid ? money(t.bid) : '—');
        setText('ask', t?.ask ? money(t.ask) : '—');
        setText('spread', t?.bid && t?.ask ? money(t.ask - t.bid) : '—');

        const low = t?.low24h ?? m?.low_24h;
        const high = t?.high24h ?? m?.high_24h;
        setText('low-24h', money(low, 0));
        setText('high-24h', money(high, 0));
        if (low != null && high != null && price != null && high > low) {
            const p = Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
            $('#range-fill').style.width = `${p}%`;
            $('#range-thumb').style.left = `${p}%`;
        }

        if (m?.ath && price) {
            const athChange = ((price - m.ath) / m.ath) * 100;
            setText('ath-sub', price >= m.ath ? 'Nieuwe all-time high, vandaag.' : `${pct(athChange)} vanaf de top van ${date(m.ath_date)}.`);
        }

        renderLead();
    }

    function renderMarket() {
        const m = market();
        const g = state.snapshot?.market;

        setText('market-cap', compactMoney(m?.market_cap));
        setText('volume', compactMoney(m?.volume_24h));
        setText('volume-btc', m?.volume_24h && m?.price ? `Ongeveer ${num(m.volume_24h / m.price)} BTC verhandeld.` : '—');
        setText('ath', money(m?.ath, 0));

        $$('[data-perf]').forEach((el) => {
            const v = m?.[el.dataset.perf];
            const dd = $('dd', el);
            dd.textContent = pct(v, 1);
            setTrend(dd, v);
        });

        if (g?.circulating_supply) {
            const max = g.max_supply || 21e6;
            setText('supply', `${num(g.circulating_supply)} BTC`);
            $('#supply-bar').style.width = `${(g.circulating_supply / max) * 100}%`;
            setText('supply-sub', `${num((g.circulating_supply / max) * 100, 2)}% van ${num(max)}. Nog ${num(max - g.circulating_supply)} te minen.`);
        }

        const s = state.snapshot?.sentiment;
        if (s?.value != null) {
            setText('fng-value', String(s.value));
            setText('fng-label', translateFng(s.label));
            setText('hero-fng', `${s.value} / 100`);
            $('#fng-arc').setAttribute('stroke-dasharray', `${s.value} 100`);
            const a = Math.PI * (1 - s.value / 100);
            $('#fng-knob').setAttribute('cx', (100 + 84 * Math.cos(a)).toFixed(1));
            $('#fng-knob').setAttribute('cy', (100 - 84 * Math.sin(a)).toFixed(1));
        }

        renderPrice();
    }

    function translateFng(label) {
        return ({
            'Extreme Fear': 'Extreme angst',
            'Fear': 'Angst',
            'Neutral': 'Neutraal',
            'Greed': 'Hebzucht',
            'Extreme Greed': 'Extreme hebzucht',
        })[label] ?? label ?? '—';
    }

    // Intro onder de hero-kop: stellig, met cijfers, zonder overtreffende trappen.
    function renderLead() {
        const c = liveChange24h();
        const t = state.live[state.currency];
        const m = market();
        const low = t?.low24h ?? m?.low_24h;
        const high = t?.high24h ?? m?.high_24h;
        if (c == null) return;
        const dir = c >= 0 ? 'hoger' : 'lager';
        const text = `${pct(Math.abs(c), 1).replace('+', '')} ${dir} dan gisteren. Bandbreedte vandaag ${money(low, 0)} tot ${money(high, 0)}.`;
        setText('hero-lead', text);
    }

    function renderNetwork() {
        const n = state.snapshot?.network;
        if (!n) return;

        setText('issue-number', num(n.height));
        setText('height', num(n.height));
        if (n.blocks?.[0]?.timestamp) setText('height-sub', `Laatste blok ${ago(n.blocks[0].timestamp)}.`);
        setText('hashrate', hashrate(n.hashrate));

        setText('mempool-count', n.mempool?.count != null ? `${num(n.mempool.count)} tx` : '—');
        setText('mempool-sub', n.mempool?.vsize != null ? `${num(n.mempool.vsize / 1e6, 1)} MvB wacht op een blok.` : '—');

        setText('fee-low', n.fees ? String(n.fees.hourFee) : '—');
        setText('fee-mid', n.fees ? String(n.fees.halfHourFee) : '—');
        setText('fee-high', n.fees ? String(n.fees.fastestFee) : '—');

        const d = n.difficulty ?? {};
        const diffEl = $('#diff-change');
        diffEl.textContent = d.change != null ? `${pct(d.change)} verwacht` : '—';
        setTrend(diffEl, d.change);
        if (d.progress != null) $('#diff-bar').style.width = `${d.progress}%`;
        setText('diff-sub', d.remaining_blocks != null
            ? `${num(d.progress, 1)}% van de periode. Nog ${num(d.remaining_blocks)} blokken, rond ${date(d.estimated_retarget)}.`
            : '—');

        const h = n.halving;
        if (h) {
            $('#halving-bar').style.width = `${h.progress}%`;
            setText('halving-sub', `Blok ${num(h.next_height)}. Beloning van ${num(h.subsidy, 3)} naar ${num(h.next_subsidy, 5)} BTC, rond ${date(h.estimated_date)}.`);
        }

        renderBlocks(n.blocks ?? []);
    }

    function renderBlocks(blocks) {
        const wrap = $('#blocks');
        if (!blocks.length) return;
        const key = blocks.map((b) => b.height).join(',');
        if (wrap.dataset.key === key) {
            $$('[data-ts]', wrap).forEach((el) => { el.textContent = ago(+el.dataset.ts); });
            return;
        }
        const isUpdate = !!wrap.dataset.key;
        wrap.dataset.key = key;
        wrap.innerHTML = blocks.map((b, i) => `
            <li class="body-sm${isUpdate && i === 0 ? ' is-new' : ''}">
                <a href="https://mempool.space/block/${encodeURIComponent(b.id ?? b.height)}" target="_blank" rel="noopener">
                    <span class="block__height">${num(b.height)}</span>
                    <span class="block__pool">${escapeHtml(b.pool ?? 'Onbekende pool')}</span>
                    <span class="block__meta"><b>${num(b.tx_count)}</b> tx · <span data-ts="${b.timestamp}">${ago(b.timestamp)}</span></span>
                </a>
            </li>`).join('');
    }

    /* ---------- Halving-countdown ---------- */

    function tickCountdown() {
        const iso = state.snapshot?.network?.halving?.estimated_date;
        if (!iso) return;
        let s = Math.max(0, Math.floor((new Date(iso) - Date.now()) / 1000));
        const d = Math.floor(s / 86400); s -= d * 86400;
        const h = Math.floor(s / 3600); s -= h * 3600;
        const m = Math.floor(s / 60); s -= m * 60;
        const vals = { d: num(d), h: String(h).padStart(2, '0'), m: String(m).padStart(2, '0'), s: String(s).padStart(2, '0') };
        $$('#halving-countdown [data-unit]').forEach((el) => { el.textContent = vals[el.dataset.unit]; });
    }

    /* ---------- Live trades ---------- */

    function pushTrade(t) {
        const list = $('#trades');
        $('.trades-empty', list)?.remove();
        const li = document.createElement('li');
        li.className = `body-sm ${t.side}${t.size >= 1 ? ' large' : ''}`;
        li.innerHTML = `<span class="side label">${t.side === 'buy' ? 'KOOP' : 'VERKOOP'}</span>
            <span class="px">${money(t.price)}</span>
            <span class="size">${num(t.size, 4)} BTC</span>`;
        list.prepend(li);
        while (list.children.length > 10) list.lastElementChild.remove();
    }

    /* ---------- Coinbase WebSocket ---------- */

    function connectCoinbase() {
        let ws;
        let retry = 0;
        let watchdog;

        const open = () => {
            setLive('connecting');
            try { ws = new WebSocket('wss://ws-feed.exchange.coinbase.com'); } catch { return schedule(); }

            ws.addEventListener('open', () => {
                retry = 0;
                ws.send(JSON.stringify({
                    type: 'subscribe',
                    product_ids: ['BTC-USD', 'BTC-EUR'],
                    channels: ['ticker', 'heartbeat'],
                }));
            });

            ws.addEventListener('message', (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch { return; }
                resetWatchdog();
                if (msg.type === 'ticker') onTicker(msg);
                if (msg.type === 'subscriptions') { state.wsConnected = true; setLive('live'); }
            });

            ws.addEventListener('close', () => { state.wsConnected = false; setLive('poll'); schedule(); });
            ws.addEventListener('error', () => ws.close());
        };

        // Als er 20s niets binnenkomt (ook geen heartbeat), opnieuw verbinden.
        const resetWatchdog = () => {
            clearTimeout(watchdog);
            watchdog = setTimeout(() => ws?.close(), 20000);
        };

        const schedule = () => {
            clearTimeout(watchdog);
            retry++;
            setTimeout(open, Math.min(30000, 1000 * 2 ** retry));
        };

        open();
    }

    let renderQueued = false;
    function onTicker(m) {
        const cur = m.product_id === 'BTC-EUR' ? 'eur' : 'usd';
        const price = parseFloat(m.price);
        if (!Number.isFinite(price)) return;

        state.live[cur] = {
            price,
            open24h: parseFloat(m.open_24h) || null,
            low24h: parseFloat(m.low_24h) || null,
            high24h: parseFloat(m.high_24h) || null,
            bid: parseFloat(m.best_bid) || null,
            ask: parseFloat(m.best_ask) || null,
            time: m.time,
        };

        if (cur !== state.currency) return;

        if (m.last_size && m.side) {
            pushTrade({ price, size: parseFloat(m.last_size), side: m.side === 'sell' ? 'sell' : 'buy' });
        }
        updateChartLive(price);

        if (!renderQueued) {
            renderQueued = true;
            requestAnimationFrame(() => { renderQueued = false; renderPrice(); });
        }
    }

    /* ---------- mempool.space WebSocket ---------- */

    function connectMempool() {
        let retry = 0;
        const open = () => {
            let ws;
            try { ws = new WebSocket('wss://mempool.space/api/v1/ws'); } catch { return; }
            ws.addEventListener('open', () => {
                retry = 0;
                ws.send(JSON.stringify({ action: 'want', data: ['blocks', 'stats', 'mempool-blocks'] }));
            });
            ws.addEventListener('message', (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch { return; }
                const n = state.snapshot?.network;
                if (!n) return;

                if (msg.block) onNewBlock(msg.block);
                if (msg.fees) n.fees = { ...n.fees, ...msg.fees };
                if (msg.mempoolInfo) n.mempool = { ...n.mempool, count: msg.mempoolInfo.size, vsize: msg.mempoolInfo.bytes };
                if (msg.da) {
                    n.difficulty = {
                        ...n.difficulty,
                        progress: msg.da.progressPercent ?? n.difficulty?.progress,
                        change: msg.da.difficultyChange ?? n.difficulty?.change,
                        remaining_blocks: msg.da.remainingBlocks ?? n.difficulty?.remaining_blocks,
                        estimated_retarget: msg.da.estimatedRetargetDate ? new Date(msg.da.estimatedRetargetDate).toISOString() : n.difficulty?.estimated_retarget,
                    };
                }
                if (msg.fees || msg.mempoolInfo || msg.da) renderNetwork();
            });
            ws.addEventListener('close', () => setTimeout(open, Math.min(60000, 2000 * 2 ** ++retry)));
            ws.addEventListener('error', () => ws.close());
        };
        open();
    }

    function onNewBlock(b) {
        const n = state.snapshot.network;
        if (!b?.height || b.height <= (n.height ?? 0)) return;
        n.height = b.height;
        n.blocks = [{
            height: b.height,
            id: b.id,
            timestamp: b.timestamp,
            tx_count: b.tx_count,
            size: b.size,
            pool: b.extras?.pool?.name ?? null,
        }, ...(n.blocks ?? [])].slice(0, 6);

        // halving lokaal herberekenen
        const interval = 210000;
        const epoch = Math.floor(b.height / interval);
        const next = (epoch + 1) * interval;
        n.halving = {
            ...n.halving,
            next_height: next,
            remaining_blocks: next - b.height,
            progress: ((b.height % interval) / interval) * 100,
            estimated_date: new Date(Date.now() + (next - b.height) * 600000).toISOString(),
        };

        renderNetwork();
    }

    /* ---------- Live-status ---------- */

    function setLive(mode) {
        const pill = $('#live-pill');
        pill.dataset.state = mode;
        setText('live-text', { connecting: 'VERBINDEN', live: 'LIVE', poll: 'POLLING', offline: 'OFFLINE' }[mode]);
    }

    /* ---------- Snapshot polling (markt/netwerk) ---------- */

    async function refreshSnapshot() {
        try {
            const data = await api.snapshot();
            // Behoud live netwerkdata als de API (nog) een ouder blok kent.
            if (state.snapshot?.network?.height > (data.network?.height ?? 0)) data.network = state.snapshot.network;
            state.snapshot = data;
            renderMarket();
            renderNetwork();
            setText('updated-at', new Date(data.generated_at).toLocaleTimeString('nl-NL'));
            if (!state.wsConnected) setLive('poll');
        } catch {
            if (!state.wsConnected) setLive('offline');
        }
    }

    /* ---------- Grafiek ---------- */

    let chartReq = 0;

    async function loadChart() {
        const id = ++chartReq;
        const status = $('#chart-status');
        status.textContent = 'GRAFIEK LADEN';
        try {
            const data = await api.chart(state.range, state.currency);
            if (id !== chartReq) return;
            state.candles = (data.candles ?? []).map((c) => ({ t: c.t * 1000, c: c.c }));
            if (state.candles.length < 2) throw new Error('geen data');
            status.textContent = '';
            drawChart();
        } catch {
            if (id !== chartReq) return;
            state.candles = [];
            $('#chart-svg').innerHTML = '';
            status.textContent = 'GRAFIEKDATA NIET BESCHIKBAAR';
        }
    }

    // Laatste punt van de 24u-grafiek meeschuiven met de live prijs.
    let chartPending = false;
    function updateChartLive(price) {
        if (state.range !== '1d' || state.candles.length < 2) return;
        const last = state.candles[state.candles.length - 1];
        const now = Date.now();
        if (now - last.t > 5 * 60 * 1000) state.candles.push({ t: now, c: price });
        else last.c = price;
        if (!chartPending) {
            chartPending = true;
            setTimeout(() => { chartPending = false; drawChart(); }, 1000);
        }
    }

    function drawChart() {
        const svg = $('#chart-svg');
        const pts = state.candles;
        if (pts.length < 2) return;
        const { width: W, height: H } = svg.getBoundingClientRect();
        if (!W || !H) return;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

        const pad = { t: 12, r: 72, b: 28, l: 0 };
        const min = Math.min(...pts.map((p) => p.c));
        const max = Math.max(...pts.map((p) => p.c));
        const span = max - min || 1;
        const t0 = pts[0].t;
        const t1 = pts[pts.length - 1].t;
        const x = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
        const y = (v) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);

        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join('');
        const area = `${line}L${x(t1).toFixed(1)},${H - pad.b}L${x(t0).toFixed(1)},${H - pad.b}Z`;
        const first = pts[0].c;
        const last = pts[pts.length - 1].c;
        const change = ((last - first) / first) * 100;
        const lastX = x(t1);
        const lastY = y(last);

        const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + span * f);
        const grid = ticks.map((v) => `<line x1="0" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#FFFFFF" stroke-opacity=".07"/>`).join('');
        const yLabels = ticks.map((v) => `<text x="${W - pad.r + 12}" y="${y(v) + 4}" class="axis">${money(v, 0)}</text>`).join('');

        const fmtOpts = state.range === '1d' ? { hour: '2-digit', minute: '2-digit' } : state.range === '1y' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
        const xLabels = [0.04, 0.35, 0.65, 0.96].map((f) => {
            const t = t0 + (t1 - t0) * f;
            return `<text x="${x(t)}" y="${H - 6}" class="axis" text-anchor="middle">${new Date(t).toLocaleString('nl-NL', fmtOpts)}</text>`;
        }).join('');

        svg.innerHTML = `
            <defs>
                <linearGradient id="spectrum" x1="0" x2="1">
                    <stop offset="0" stop-color="#7C3AED"/><stop offset=".5" stop-color="#2563EB"/><stop offset="1" stop-color="#00F0FF"/>
                </linearGradient>
                <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stop-color="#7C3AED" stop-opacity=".28"/>
                    <stop offset="1" stop-color="#7C3AED" stop-opacity="0"/>
                </linearGradient>
                <filter id="glow" x="-10%" y="-30%" width="120%" height="160%">
                    <feGaussianBlur stdDeviation="6"/>
                </filter>
            </defs>
            <style>.axis{font:500 11px var(--font-sans);letter-spacing:.04em;fill:#9A9EA8;font-variant-numeric:tabular-nums}</style>
            ${grid}
            <path d="${area}" fill="url(#area)"/>
            <path d="${line}" fill="none" stroke="url(#spectrum)" stroke-width="6" stroke-opacity=".45" filter="url(#glow)"/>
            <path d="${line}" fill="none" stroke="url(#spectrum)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            <circle cx="${lastX}" cy="${lastY}" r="10" fill="#00F0FF" fill-opacity=".18"/>
            <circle cx="${lastX}" cy="${lastY}" r="4" fill="#00F0FF"/>
            ${yLabels}${xLabels}
            <g id="crosshair" style="display:none">
                <line id="ch-line" y1="${pad.t}" y2="${H - pad.b}" stroke="#FFFFFF" stroke-opacity=".35"/>
                <circle id="ch-dot" r="5" fill="#0F1115" stroke="#A07CFF" stroke-width="2"/>
            </g>`;

        const ch = $('#chart-change');
        ch.textContent = pct(change);
        setTrend(ch, change);

        svg._scale = { x, y, pts };
    }

    function bindChartHover() {
        const chart = $('#chart');
        const tip = $('#chart-tip');
        const move = (e) => {
            const svg = $('#chart-svg');
            const s = svg._scale;
            if (!s) return;
            const rect = svg.getBoundingClientRect();
            const px = (e.touches?.[0]?.clientX ?? e.clientX) - rect.left;
            let best = s.pts[0];
            let bestD = Infinity;
            for (const p of s.pts) {
                const d = Math.abs(s.x(p.t) - px);
                if (d < bestD) { bestD = d; best = p; }
            }
            const cx = s.x(best.t);
            const cy = s.y(best.c);
            $('#crosshair').style.display = '';
            $('#ch-line').setAttribute('x1', cx); $('#ch-line').setAttribute('x2', cx);
            $('#ch-dot').setAttribute('cx', cx); $('#ch-dot').setAttribute('cy', cy);
            tip.hidden = false;
            tip.style.left = `${Math.min(Math.max(cx, 80), rect.width - 80)}px`;
            tip.innerHTML = `<b>${money(best.c)}</b>${new Date(best.t).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
        };
        const leave = () => { tip.hidden = true; const c = $('#crosshair'); if (c) c.style.display = 'none'; };
        chart.addEventListener('pointermove', move);
        chart.addEventListener('pointerleave', leave);
        chart.addEventListener('touchmove', move, { passive: true });
        chart.addEventListener('touchend', leave);
        let rt;
        addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawChart, 120); });
    }

    /* ---------- Schakelaars ---------- */

    function bindToggles() {
        const sync = () => {
            $$('[data-currency]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.currency === state.currency)));
            $$('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
        };
        $$('[data-currency]').forEach((b) => b.addEventListener('click', () => {
            if (state.currency === b.dataset.currency) return;
            state.currency = b.dataset.currency;
            storage.set('btc.currency', state.currency);
            prevRendered = null;
            $('#trades').innerHTML = '<li class="trades-empty body-sm">Wachten op de eerste trade.</li>';
            sync(); renderMarket(); loadChart();
        }));
        $$('[data-range]').forEach((b) => b.addEventListener('click', () => {
            if (state.range === b.dataset.range) return;
            state.range = b.dataset.range;
            storage.set('btc.range', state.range);
            sync(); loadChart();
        }));
        sync();
    }

    /* ---------- Start ---------- */

    renderIcons();
    bindToggles();
    bindChartHover();
    tickCountdown();
    setInterval(tickCountdown, 1000);
    setInterval(() => renderBlocks(state.snapshot?.network?.blocks ?? []), 15000);
    loadChart();
    refreshSnapshot();
    setInterval(() => { if (!document.hidden) refreshSnapshot(); }, 30000);
    setInterval(() => { if (!document.hidden && state.range !== '1d') loadChart(); }, 5 * 60000);

    if ('WebSocket' in window) {
        connectCoinbase();
        connectMempool();
    } else {
        setLive('poll');
    }
})();
