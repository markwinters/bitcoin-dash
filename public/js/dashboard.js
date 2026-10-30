/* ==========================================================================
   The Amazing Bitcoin — realtime dashboard
   - Live koers + trades: Coinbase Exchange WebSocket (ticker channel)
   - Nieuwe blokken + fees: mempool.space WebSocket
   - Markt/netwerk-snapshot + grafiek: Laravel API (server-side gecached)
   ========================================================================== */
(() => {
    'use strict';

    const { snapshot: initial, endpoints } = window.BTC_CONFIG;
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
        snapshot: initial,
        live: { usd: null, eur: null }, // laatste Coinbase ticker per valuta
        candles: [],
        lastBurstPrice: null,
        lastBurstAt: 0,
        wsConnected: false,
    };
    if (!['usd', 'eur'].includes(state.currency)) state.currency = 'eur';

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
    const bytes = (b) => b == null ? '—' : `${num(b / 1e6, 1)} MvB`;
    const date = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => iso ? new Date(iso).toLocaleDateString('nl-NL', opts) : '—';
    const ago = (ts) => {
        const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
        if (s < 60) return `${s}s geleden`;
        if (s < 3600) return `${Math.floor(s / 60)} min geleden`;
        return `${Math.floor(s / 3600)} uur geleden`;
    };
    const setText = (id, text) => { const el = document.getElementById(id); if (el && el.textContent !== text) el.textContent = text; };
    const setTrend = (el, v) => { el.classList.remove('up', 'down'); const t = trend(v); if (t) el.classList.add(t); };

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

    function renderPrice() {
        const price = livePrice();
        const t = state.live[state.currency];
        const m = market();
        const el = $('#price');

        setText('price', money(price));
        document.title = price ? `${money(price, 0)} · The Amazing Bitcoin` : 'The Amazing Bitcoin — Holo Dashboard';

        if (prevRendered != null && price != null && price !== prevRendered && !reducedMotion) {
            el.classList.remove('tick-up', 'tick-down');
            void el.offsetWidth;
            el.classList.add(price > prevRendered ? 'tick-up' : 'tick-down');
        }
        prevRendered = price;

        const change = liveChange24h();
        const badge = $('#change-24h');
        badge.textContent = `${pct(change)} 24u`;
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
            setText('ath-sub', price >= m.ath ? '🚀 NIEUWE ATH! EXCELSIOR!' : `${pct(athChange)} vanaf ATH · ${date(m.ath_date)}`);
        }
    }

    function renderMarket() {
        const m = market();
        const g = state.snapshot?.market;

        setText('market-cap', compactMoney(m?.market_cap));
        setText('volume', compactMoney(m?.volume_24h));
        setText('volume-btc', m?.volume_24h && m?.price ? `≈ ${num(m.volume_24h / m.price)} BTC verhandeld` : '—');
        setText('ath', money(m?.ath, 0));

        $$('[data-perf]').forEach((el) => {
            const v = m?.[el.dataset.perf];
            const b = $('b', el);
            b.textContent = pct(v, 1);
            setTrend(b, v);
        });

        if (g?.circulating_supply) {
            const max = g.max_supply || 21e6;
            setText('supply', `${num(g.circulating_supply)} BTC`);
            $('#supply-bar').style.width = `${(g.circulating_supply / max) * 100}%`;
            setText('supply-sub', `${num((g.circulating_supply / max) * 100, 2)}% van de ${num(max)} — nog ${num(max - g.circulating_supply)} te minen`);
        }

        const s = state.snapshot?.sentiment;
        if (s?.value != null) {
            setText('fng-value', String(s.value));
            setText('fng-label', translateFng(s.label));
            $('#fng-needle').style.transform = `rotate(${(s.value / 100) * 180 - 90}deg)`;
        }

        renderPrice();
        renderSpeech();
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

    function renderNetwork() {
        const n = state.snapshot?.network;
        if (!n) return;

        setText('issue-number', `#${num(n.height)}`);
        setText('height', num(n.height));
        if (n.blocks?.[0]?.timestamp) setText('height-sub', `Laatste blok ${ago(n.blocks[0].timestamp)}`);
        setText('hashrate', hashrate(n.hashrate));

        setText('mempool-count', n.mempool?.count != null ? `${num(n.mempool.count)} tx` : '—');
        setText('mempool-sub', n.mempool?.vsize != null ? `${bytes(n.mempool.vsize)} wacht op een blok` : '—');

        setText('fee-low', n.fees ? String(n.fees.hourFee) : '—');
        setText('fee-mid', n.fees ? String(n.fees.halfHourFee) : '—');
        setText('fee-high', n.fees ? String(n.fees.fastestFee) : '—');

        const d = n.difficulty ?? {};
        const diffEl = $('#diff-change');
        diffEl.textContent = d.change != null ? `${pct(d.change)} verwacht` : '—';
        setTrend(diffEl, d.change);
        if (d.progress != null) $('#diff-bar').style.width = `${d.progress}%`;
        setText('diff-sub', d.remaining_blocks != null
            ? `${num(d.progress, 1)}% van de epoch · nog ${num(d.remaining_blocks)} blokken · ±${date(d.estimated_retarget)}`
            : '—');

        const h = n.halving;
        if (h) {
            $('#halving-bar').style.width = `${h.progress}%`;
            setText('halving-sub', `Blok ${num(h.next_height)} · nog ${num(h.remaining_blocks)} blokken · beloning ${num(h.subsidy, 3)} → ${num(h.next_subsidy, 5)} BTC · ±${date(h.estimated_date)}`);
        }

        renderBlocks(n.blocks ?? []);
    }

    function renderBlocks(blocks) {
        const wrap = $('#blocks');
        if (!blocks.length) return;
        const key = blocks.map((b) => b.height).join(',');
        if (wrap.dataset.key === key) {
            // alleen relatieve tijden bijwerken
            $$('[data-ts]', wrap).forEach((el) => { el.textContent = ago(+el.dataset.ts); });
            return;
        }
        wrap.dataset.key = key;
        wrap.innerHTML = blocks.map((b) => `
            <a class="block" href="https://mempool.space/block/${encodeURIComponent(b.id ?? b.height)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">
                <div class="block-height">#${num(b.height)}</div>
                <div class="block-row"><span>Tx</span><b>${num(b.tx_count)}</b></div>
                <div class="block-row"><span>Grootte</span><b>${b.size ? num(b.size / 1e6, 2) + ' MB' : '—'}</b></div>
                <div class="block-row"><span>Tijd</span><b data-ts="${b.timestamp}">${ago(b.timestamp)}</b></div>
                <div class="block-pool">${escapeHtml(b.pool ?? 'Onbekend')}</div>
            </a>`).join('');
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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

    /* ---------- Verteller / speech bubble ---------- */

    let lastSpeech = '';
    function renderSpeech() {
        const c = liveChange24h();
        const fng = state.snapshot?.sentiment?.value;
        let line;
        if (c == null) line = 'Hou je vast, true believer… de data komt eraan!';
        else if (c >= 5) line = `KA-BOOM! ${pct(c, 1)} in 24 uur — de bulls zijn onstuitbaar!`;
        else if (c >= 1.5) line = `Met grote kracht komt grote winst: ${pct(c, 1)} vandaag!`;
        else if (c > 0) line = `Een rustige dag in het multiversum… ${pct(c, 1)}. Satoshi glimlacht.`;
        else if (c > -1.5) line = `Een klein schrammetje (${pct(c, 1)}). Helden laten zich niet kennen!`;
        else if (c > -5) line = `OEF! ${pct(c, 1)}… de schurken van de bear market slaan terug!`;
        else line = `KRAK! ${pct(c, 1)}! Tijd om de Avengers van de HODL te verzamelen!`;
        if (fng != null && fng <= 20) line += ' (De markt beeft van angst…)';
        if (fng != null && fng >= 80) line += ' (Hebzucht alarm!)';

        if (line !== lastSpeech) {
            const el = $('#speech');
            el.textContent = line;
            if (lastSpeech && !reducedMotion) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
            lastSpeech = line;
        }
    }

    /* ---------- Comic bursts ---------- */

    const UP_WORDS = ['POW!', 'ZAP!', 'BAM!', 'WHAM!', 'KA-CHING!'];
    const DOWN_WORDS = ['OEF!', 'KRAK!', 'BONK!', 'SPLAT!', 'AUW!'];

    function burstSvg(fill) {
        const pts = [];
        const spikes = 14;
        for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 === 0 ? 50 : 34 + Math.random() * 6;
            const a = (Math.PI * i) / spikes;
            pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
        }
        return `<svg viewBox="-2 -2 104 104"><polygon points="${pts.join(' ')}" fill="${fill}" stroke="#07050f" stroke-width="3" stroke-linejoin="round"/></svg>`;
    }

    function burst(word, { fill = '#ffe14d', sub = '', x, y } = {}) {
        if (reducedMotion || document.hidden) return;
        const layer = $('#burst-layer');
        const el = document.createElement('div');
        el.className = 'burst';
        el.style.left = `${x ?? 15 + Math.random() * 70}vw`;
        el.style.top = `${y ?? 18 + Math.random() * 50}vh`;
        el.innerHTML = `${burstSvg(fill)}<span>${escapeHtml(word)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>`;
        layer.appendChild(el);
        el.addEventListener('animationend', () => el.remove(), { once: true });
    }

    function maybeBurst(price) {
        const now = Date.now();
        if (state.lastBurstPrice == null) { state.lastBurstPrice = price; return; }
        const move = ((price - state.lastBurstPrice) / state.lastBurstPrice) * 100;
        if (Math.abs(move) >= 0.15 && now - state.lastBurstAt > 8000) {
            const up = move > 0;
            const words = up ? UP_WORDS : DOWN_WORDS;
            burst(words[Math.floor(Math.random() * words.length)], { fill: up ? '#2dffb3' : '#ff2e63', sub: pct(move, 2) });
            state.lastBurstPrice = price;
            state.lastBurstAt = now;
        }
    }

    /* ---------- Live trades ---------- */

    function pushTrade(t) {
        const list = $('#trades');
        $('.trades-empty', list)?.remove();
        const li = document.createElement('li');
        li.className = `${t.side}${t.size >= 1 ? ' whale' : ''}`;
        li.innerHTML = `<span class="side">${t.side === 'buy' ? 'KOOP' : 'VERKOOP'}</span>
            <span>${money(t.price)}</span>
            <span class="size">${t.size >= 1 ? '🐋 ' : ''}${num(t.size, 4)} ₿</span>`;
        list.prepend(li);
        while (list.children.length > 14) list.lastElementChild.remove();
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
        maybeBurst(price);
        updateChartLive(price);

        if (!renderQueued) {
            renderQueued = true;
            requestAnimationFrame(() => { renderQueued = false; renderPrice(); renderSpeech(); });
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
        burst('KABOOM!', { fill: '#f7931a', sub: `Blok #${num(b.height)}`, x: 50, y: 40 });
    }

    /* ---------- Live status pill ---------- */

    function setLive(mode) {
        const pill = $('#live-pill');
        const label = { connecting: 'Verbinden…', live: 'Live', poll: 'Polling', offline: 'Offline' }[mode];
        pill.dataset.state = mode;
        setText('live-text', label);
    }

    /* ---------- Snapshot polling (fallback + markt/netwerk) ---------- */

    async function refreshSnapshot() {
        try {
            const res = await fetch(endpoints.snapshot, { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();
            // Behoud live netwerkdata als de server (nog) een ouder blok kent.
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

    const svgNS = 'http://www.w3.org/2000/svg';
    let chartReq = 0;

    async function loadChart() {
        const id = ++chartReq;
        const status = $('#chart-status');
        status.textContent = 'Grafiek laden…';
        try {
            const url = `${endpoints.chart}?range=${state.range}&currency=${state.currency}`;
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            const data = await res.json();
            if (id !== chartReq) return;
            state.candles = (data.candles ?? []).map((c) => ({ t: c.t * 1000, c: c.c }));
            if (state.candles.length < 2) throw new Error('geen data');
            status.textContent = '';
            drawChart();
        } catch {
            if (id !== chartReq) return;
            state.candles = [];
            $('#chart-svg').innerHTML = '';
            status.textContent = 'ARGH! Grafiekdata niet beschikbaar.';
        }
    }

    // Laatste punt van de 24u-grafiek meeschuiven met de live prijs.
    let chartRaf = false;
    function updateChartLive(price) {
        if (state.range !== '1d' || state.candles.length < 2) return;
        const last = state.candles[state.candles.length - 1];
        const now = Date.now();
        if (now - last.t > 5 * 60 * 1000) state.candles.push({ t: now, c: price });
        else last.c = price;
        if (!chartRaf) {
            chartRaf = true;
            setTimeout(() => { chartRaf = false; drawChart(); }, 1000);
        }
    }

    function drawChart() {
        const svg = $('#chart-svg');
        const pts = state.candles;
        if (pts.length < 2) return;
        const { width: W, height: H } = svg.getBoundingClientRect();
        if (!W || !H) return;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

        const pad = { t: 24, r: 70, b: 26, l: 12 };
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

        // y-as labels
        const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + span * f);
        const yLabels = ticks.map((v) => `<text x="${W - pad.r + 8}" y="${y(v) + 4}" class="axis">${money(v, 0)}</text>`).join('');

        // x-as labels
        const fmtOpts = state.range === '1d' ? { hour: '2-digit', minute: '2-digit' } : state.range === '1y' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
        const xLabels = [0.05, 0.35, 0.65, 0.95].map((f) => {
            const t = t0 + (t1 - t0) * f;
            return `<text x="${x(t)}" y="${H - 7}" class="axis" text-anchor="middle">${new Date(t).toLocaleString('nl-NL', fmtOpts)}</text>`;
        }).join('');

        svg.innerHTML = `
            <defs>
                <linearGradient id="holo-stroke" x1="0" x2="1">
                    <stop offset="0" stop-color="#ff4dd8"/><stop offset=".25" stop-color="#ffe14d"/>
                    <stop offset=".5" stop-color="#2dffb3"/><stop offset=".75" stop-color="#4df3ff"/>
                    <stop offset="1" stop-color="#8b5cff"/>
                </linearGradient>
                <linearGradient id="holo-area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stop-color="#8b5cff" stop-opacity=".55"/>
                    <stop offset="1" stop-color="#8b5cff" stop-opacity="0"/>
                </linearGradient>
                <pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse">
                    <circle cx="3" cy="3" r="1.1" fill="#fff" fill-opacity=".18"/>
                </pattern>
            </defs>
            <style>.axis{font:600 11px 'JetBrains Mono',monospace;fill:#b9b2e0}</style>
            <path d="${area}" fill="url(#holo-area)"/>
            <path d="${area}" fill="url(#dots)"/>
            <path d="${line}" fill="none" stroke="#07050f" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
            <path d="${line}" fill="none" stroke="url(#holo-stroke)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
            <line x1="${pad.l}" x2="${W - pad.r}" y1="${lastY}" y2="${lastY}" stroke="#fff" stroke-opacity=".35" stroke-dasharray="4 6"/>
            <circle cx="${lastX}" cy="${lastY}" r="7" fill="#ffe14d" stroke="#07050f" stroke-width="3">
                ${reducedMotion ? '' : '<animate attributeName="r" values="7;10;7" dur="1.4s" repeatCount="indefinite"/>'}
            </circle>
            ${yLabels}${xLabels}
            <g id="crosshair" style="display:none">
                <line id="ch-line" y1="${pad.t}" y2="${H - pad.b}" stroke="#fff" stroke-width="2" stroke-dasharray="3 4"/>
                <circle id="ch-dot" r="6" fill="#fff" stroke="#07050f" stroke-width="3"/>
            </g>`;

        const ch = $('#chart-change');
        ch.textContent = `${pct(change)} deze periode`;
        setTrend(ch, change);

        svg._scale = { x, y, pts, W };
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

    /* ---------- Holo-kaart tilt ---------- */

    function bindTilt() {
        if (reducedMotion || matchMedia('(hover: none)').matches) return;
        $$('[data-tilt]').forEach((el) => {
            const strength = el.dataset.tilt === 'soft' ? 2 : 6;
            el.addEventListener('pointermove', (e) => {
                const r = el.getBoundingClientRect();
                const px = (e.clientX - r.left) / r.width;
                const py = (e.clientY - r.top) / r.height;
                el.style.setProperty('--mx', `${px * 100}%`);
                el.style.setProperty('--my', `${py * 100}%`);
                el.style.setProperty('--rx', `${(0.5 - py) * strength}deg`);
                el.style.setProperty('--ry', `${(px - 0.5) * strength}deg`);
            });
            el.addEventListener('pointerleave', () => {
                el.style.setProperty('--rx', '0deg');
                el.style.setProperty('--ry', '0deg');
            });
        });
    }

    /* ---------- Toggles ---------- */

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
            state.lastBurstPrice = null;
            $('#trades').innerHTML = '<li class="trades-empty">Wachten op de eerste trade…</li>';
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

    bindToggles();
    bindTilt();
    bindChartHover();
    renderMarket();
    renderNetwork();
    if (initial?.generated_at) setText('updated-at', new Date(initial.generated_at).toLocaleTimeString('nl-NL'));
    tickCountdown();
    setInterval(tickCountdown, 1000);
    setInterval(() => renderBlocks(state.snapshot?.network?.blocks ?? []), 15000);
    loadChart();
    setInterval(() => { if (!document.hidden) refreshSnapshot(); }, 30000);
    setInterval(() => { if (!document.hidden && state.range !== '1d') loadChart(); }, 5 * 60000);

    if ('WebSocket' in window) {
        connectCoinbase();
        connectMempool();
    } else {
        setLive('poll');
    }
})();
