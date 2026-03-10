const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = 5000;

const VIDEO_HEADERS = {
    'Referer': 'https://m.mydramawave.com/',
    'Origin': 'https://m.mydramawave.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};

function getBaseUrl() {
    if (process.env.BOT_BASE_URL) return process.env.BOT_BASE_URL;
    if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
    return `http://localhost:${PORT}`;
}

app.get('/player', (req, res) => {
    res.sendFile(path.join(__dirname, 'player.html'));
});

app.get('/proxy/m3u8', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');

    try {
        const response = await axios.get(decodeURIComponent(url), {
            headers: VIDEO_HEADERS,
            responseType: 'text'
        });

        const m3u8Text = response.data;
        const baseUrl = getBaseUrl();
        const sourceBase = decodeURIComponent(url).replace(/\/[^/]+\.m3u8.*$/, '/');

        const rewritten = m3u8Text.split('\n').map(line => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            // Rewrite URI="..." attributes inside #EXT-X-MEDIA and similar tags
            if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
                return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                    const absUri = uri.startsWith('http') ? uri : sourceBase + uri;
                    const proxyUri = absUri.endsWith('.m3u8')
                        ? `${baseUrl}/proxy/m3u8?url=${encodeURIComponent(absUri)}`
                        : `${baseUrl}/proxy/seg?url=${encodeURIComponent(absUri)}`;
                    return `URI="${proxyUri}"`;
                });
            }
            if (trimmed.startsWith('#')) return line;

            const absUrl = trimmed.startsWith('http') ? trimmed : sourceBase + trimmed;

            if (trimmed.endsWith('.m3u8')) {
                return `${baseUrl}/proxy/m3u8?url=${encodeURIComponent(absUrl)}`;
            }
            return `${baseUrl}/proxy/seg?url=${encodeURIComponent(absUrl)}`;
        }).join('\n');

        res.set({
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
        });
        res.send(rewritten);

    } catch (err) {
        console.error('[proxy/m3u8]', err.message);
        res.status(500).send('Proxy error: ' + err.message);
    }
});

app.get('/proxy/seg', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');

    try {
        const response = await axios.get(decodeURIComponent(url), {
            headers: VIDEO_HEADERS,
            responseType: 'stream'
        });

        res.set({
            'Content-Type': response.headers['content-type'] || 'video/mp4',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600'
        });
        response.data.pipe(res);

    } catch (err) {
        console.error('[proxy/seg]', err.message);
        res.status(500).send('Segment proxy error');
    }
});

// Proxy without auth headers (for ReelShort and other public streams)
app.get('/proxy/direct', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    try {
        const response = await axios.get(decodeURIComponent(url), { responseType: 'text', timeout: 15000 });
        const m3u8Text = response.data;
        const baseUrl = getBaseUrl();
        const sourceBase = decodeURIComponent(url).replace(/\/[^/]+\.m3u8.*$/, '/');

        const rewritten = m3u8Text.split('\n').map(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line;
            const absUrl = trimmed.startsWith('http') ? trimmed : sourceBase + trimmed;
            if (trimmed.endsWith('.m3u8')) return `${baseUrl}/proxy/direct?url=${encodeURIComponent(absUrl)}`;
            return `${baseUrl}/proxy/dirseg?url=${encodeURIComponent(absUrl)}`;
        }).join('\n');

        res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
        res.send(rewritten);
    } catch (err) {
        console.error('[proxy/direct]', err.message);
        res.status(500).send('Proxy error: ' + err.message);
    }
});

app.get('/proxy/dirseg', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');
    try {
        const response = await axios.get(decodeURIComponent(url), { responseType: 'stream', timeout: 30000 });
        res.set({ 'Content-Type': response.headers['content-type'] || 'video/mp2t', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' });
        response.data.pipe(res);
    } catch (err) {
        console.error('[proxy/dirseg]', err.message);
        res.status(500).send('Segment proxy error');
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

function startWebServer() {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Web player berjalan di port ${PORT}`);
    });
    // Port 3000 required for Replit deployment health check (first localPort in .replit)
    if (PORT !== 3000) {
        app.listen(3000, '0.0.0.0', () => {
            console.log('Health check berjalan di port 3000');
        });
    }
}

function getPlayerUrl(m3u8url, title, ep) {
    const base = getBaseUrl();
    const proxiedM3u8 = `${base}/proxy/m3u8?url=${encodeURIComponent(m3u8url)}`;
    const params = new URLSearchParams({ url: proxiedM3u8, title: title || '', ep: String(ep || '') });
    return `${base}/player?${params.toString()}`;
}

function getDirectPlayerUrl(m3u8url, title, ep) {
    const base = getBaseUrl();
    const proxiedM3u8 = `${base}/proxy/direct?url=${encodeURIComponent(m3u8url)}`;
    const params = new URLSearchParams({ url: proxiedM3u8, title: title || '', ep: String(ep || ''), platform: 'reelshort' });
    return `${base}/player?${params.toString()}`;
}

function getMeloloPlayerUrl(mp4url, title, ep) {
    const base = getBaseUrl();
    const params = new URLSearchParams({ url: mp4url, title: title || '', ep: String(ep || ''), platform: 'melolo' });
    return `${base}/player?${params.toString()}`;
}

module.exports = { startWebServer, getPlayerUrl, getDirectPlayerUrl, getMeloloPlayerUrl };
