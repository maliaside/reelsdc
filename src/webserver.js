const express = require('express');
const path = require('path');
const axios = require('axios');
const { getStats } = require('./stats');

let _botClient = null;
function setBotClient(client) { _botClient = client; }

const app = express();
const PORT = 5000;

const VIDEO_HEADERS = {
    'Referer': 'https://m.mydramawave.com/',
    'Origin': 'https://m.mydramawave.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};

const MB_HEADERS = {
    'Referer': 'https://h5.aoneroom.com',
    'Origin': 'https://h5.aoneroom.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};

function getBaseUrl() {
    if (process.env.BOT_BASE_URL) return process.env.BOT_BASE_URL;
    if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
    // In production VM deployment, REPLIT_DOMAINS contains the live domain
    if (process.env.REPLIT_DOMAINS) {
        const domain = process.env.REPLIT_DOMAINS.split(',')[0].trim();
        if (domain) return `https://${domain}`;
    }
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

// MovieBox — resolve fresh CDN URL server-side, browser streams directly
// The CDN blocks datacenter IPs; user's browser can access it directly
const mbApi = require('./api/moviebox');

function pickSource(sources, targetQ) {
    return sources.find(s => s.quality === targetQ)
        || sources.reduce((b, s) => Math.abs(s.quality - targetQ) < Math.abs(b.quality - targetQ) ? s : b, sources[0]);
}

app.get('/resolve/mb', async (req, res) => {
    const { subjectId, season, episode, quality } = req.query;
    if (!subjectId) return res.status(400).json({ error: 'Missing subjectId' });
    const targetQ = parseInt(quality) || 360;
    try {
        const srcData = season
            ? await mbApi.getEpisodeSourcesBest(subjectId, parseInt(season), parseInt(episode))
            : await mbApi.getSources(subjectId);
        const sources = mbApi.parseSources(srcData);
        if (!sources.length) return res.status(404).json({ error: 'Tidak ada sumber video tersedia' });
        const chosen = pickSource(sources, targetQ);
        res.set('Access-Control-Allow-Origin', '*');
        res.json({ url: chosen.url, quality: chosen.quality, sizeMB: chosen.sizeMB });
    } catch (err) {
        console.error('[resolve/mb]', err.message);
        res.status(502).json({ error: err.message });
    }
});

app.get('/hls.js', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(__dirname, 'hls.min.js'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api/stats', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(getStats());
});

app.get('/api/bot/status', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    const stats = getStats();
    const c = _botClient;
    const isReady = c && c.isReady && c.isReady();
    res.json({
        status: isReady ? 'online' : 'offline',
        bot_name: isReady ? c.user.tag : null,
        bot_id: isReady ? c.user.id : null,
        bot_avatar: isReady ? c.user.displayAvatarURL({ size: 128 }) : null,
        guild_count: isReady ? c.guilds.cache.size : 0,
        uptime: stats.uptimeStr,
        uptime_ms: stats.uptimeMs,
        start_time: new Date(stats.startTime).toISOString(),
        commands_total: stats.counts.total,
        commands_per_platform: {
            freereels: stats.counts.freereels,
            reelshort: stats.counts.reelshort,
            melolo: stats.counts.melolo,
        },
        downloads: stats.counts.downloads,
        streams: stats.counts.streams,
        errors: stats.counts.errors,
    });
});

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

// Player resolves fresh CDN URL at load time via /resolve/mb
// Returns h5.aoneroom.com URL directly — CDN serves video correctly from that domain.
// Our player page can't set Referer: https://h5.aoneroom.com which the CDN requires.
function getMbPlayerUrl(subjectId, quality, title, season, episode) {
    let url = `https://h5.aoneroom.com/${subjectId}`;
    if (season != null && episode != null) url += `?season=${season}&ep=${episode}`;
    return url;
}

module.exports = { startWebServer, setBotClient, getPlayerUrl, getDirectPlayerUrl, getMeloloPlayerUrl, getMbPlayerUrl };
