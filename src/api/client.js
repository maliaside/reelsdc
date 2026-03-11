const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY_URL = 'http://P7IqrnYXHd40_custom_zone_TH_st__city_sid_75186613_time_0:2417235@change5.owlproxy.com:7778';

// Create a fresh agent per request to avoid connection pool exhaustion
function makeAgent() {
    return new HttpsProxyAgent(PROXY_URL, { keepAlive: false });
}

const BASE_CONFIG = {
    timeout: 28000,
    proxy: false, // use httpsAgent instead
    headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    },
};

const client = axios.create(BASE_CONFIG);

// Attach fresh agent on every request
client.interceptors.request.use(cfg => {
    cfg.httpsAgent = makeAgent();
    return cfg;
});

client.interceptors.response.use(
    res => res,
    async err => {
        const cfg = err.config;
        if (!cfg) throw err;

        // 429 rate limit — wait and retry
        if (err.response?.status === 429) {
            cfg._retry429 = (cfg._retry429 || 0) + 1;
            if (cfg._retry429 <= 3) {
                const delay = cfg._retry429 * 3000;
                console.warn(`[proxy] 429 retry #${cfg._retry429} in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                cfg.httpsAgent = makeAgent();
                return client(cfg);
            }
        }

        // Network/proxy errors — retry with fresh agent
        const isProxyErr = !err.response && (
            err.code === 'ECONNRESET' ||
            err.code === 'ETIMEDOUT' ||
            err.code === 'ECONNREFUSED' ||
            err.message?.includes('CONNECT') ||
            err.message?.includes('socket hang up') ||
            err.message?.includes('Proxy connection')
        );
        if (isProxyErr) {
            cfg._retryProxy = (cfg._retryProxy || 0) + 1;
            if (cfg._retryProxy <= 3) {
                const delay = cfg._retryProxy * 1200;
                console.warn(`[proxy] Connection error (${err.code || err.message?.slice(0,30)}), retry #${cfg._retryProxy} in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                cfg.httpsAgent = makeAgent();
                return client(cfg);
            }
        }

        throw err;
    }
);

module.exports = client;
