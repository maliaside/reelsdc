// Direct axios — no proxy. sansekai.my.id is accessible from Replit directly.
const axios = require('axios');

const client = axios.create({
    timeout: 20000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    },
});

// Global rate limiter — min 1.0s between requests to sansekai
let _lastReq = 0;
client.interceptors.request.use(async cfg => {
    if (cfg.url?.includes('sansekai')) {
        const wait = 1000 - (Date.now() - _lastReq);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        _lastReq = Date.now();
    }
    return cfg;
});

// Auto-retry on 429 or transient network errors
client.interceptors.response.use(
    res => res,
    async err => {
        const cfg = err.config;
        if (!cfg) throw err;

        if (err.response?.status === 429) {
            cfg._r429 = (cfg._r429 || 0) + 1;
            if (cfg._r429 <= 3) {
                const delay = cfg._r429 * 4000;
                console.warn(`[api] 429 rate limit, retry #${cfg._r429} in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                return client(cfg);
            }
        }

        const transient = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED';
        if (transient && !cfg._rnet) {
            cfg._rnet = 1;
            await new Promise(r => setTimeout(r, 1000));
            return client(cfg);
        }

        throw err;
    }
);

module.exports = client;
