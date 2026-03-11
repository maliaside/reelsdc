const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Proxy credentials — rotate ID, SG, TH to find a fast IP
const PROXY_PASS = '2417235';
const PROXY_HOST = 'change5.owlproxy.com:7778';
const PROXY_BASE = 'P7IqrnYXHd40';

// Rotating residential proxy per country
// Each agent creation = new IP from that country's pool
const COUNTRIES = ['ID', 'SG', 'TH'];

function makeAgent(countryIndex) {
    const cc = COUNTRIES[countryIndex % COUNTRIES.length];
    const user = `${PROXY_BASE}_custom_zone_${cc}_st__city_sid_75186613_time_0`;
    const url = `http://${user}:${PROXY_PASS}@${PROXY_HOST}`;
    return new HttpsProxyAgent(url, { keepAlive: false });
}

// Per-attempt timeout: 6 seconds — if slow IP, bail fast and get new one
const ATTEMPT_TIMEOUT = 6000;

const client = axios.create({
    proxy: false,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    },
});

// Attach a fresh agent + per-attempt timeout on every request
client.interceptors.request.use(cfg => {
    if (!cfg._countryIdx) cfg._countryIdx = Math.floor(Math.random() * COUNTRIES.length);
    cfg.httpsAgent = makeAgent(cfg._countryIdx);
    // Use short timeout unless caller set their own
    if (!cfg._customTimeout) cfg.timeout = ATTEMPT_TIMEOUT;
    return cfg;
});

client.interceptors.response.use(
    res => res,
    async err => {
        const cfg = err.config;
        if (!cfg) throw err;

        // 429 — rate limited, wait a bit then try with next country
        if (err.response?.status === 429) {
            cfg._retry429 = (cfg._retry429 || 0) + 1;
            if (cfg._retry429 <= 3) {
                const delay = cfg._retry429 * 2500;
                const nextCC = COUNTRIES[(cfg._countryIdx + cfg._retry429) % COUNTRIES.length];
                console.warn(`[proxy] 429 → retry #${cfg._retry429} via ${nextCC} in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                cfg._countryIdx = (cfg._countryIdx + 1) % COUNTRIES.length;
                cfg.httpsAgent = makeAgent(cfg._countryIdx);
                return client(cfg);
            }
        }

        // Timeout or proxy connection error — get a new (hopefully faster) IP
        const isSlow = err.code === 'ECONNABORTED' || (err.message || '').includes('timeout');
        const isProxyErr = !err.response && (
            isSlow ||
            err.code === 'ECONNRESET' ||
            err.code === 'ETIMEDOUT' ||
            err.code === 'ECONNREFUSED' ||
            (err.message || '').includes('CONNECT') ||
            (err.message || '').includes('socket hang up') ||
            (err.message || '').includes('Proxy connection')
        );

        if (isProxyErr) {
            cfg._retryProxy = (cfg._retryProxy || 0) + 1;
            if (cfg._retryProxy <= 4) {
                // Rotate country on each retry for max IP diversity
                cfg._countryIdx = (cfg._countryIdx + 1) % COUNTRIES.length;
                const cc = COUNTRIES[cfg._countryIdx];
                const reason = isSlow ? 'slow/timeout' : (err.code || 'conn error');
                console.warn(`[proxy] ${reason} → new IP (${cc}), attempt #${cfg._retryProxy}`);
                // No delay — immediately try with fresh IP
                cfg.httpsAgent = makeAgent(cfg._countryIdx);
                return client(cfg);
            }
        }

        throw err;
    }
);

module.exports = client;
