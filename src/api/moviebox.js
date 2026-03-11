const axios = require('axios');

const BASE = 'https://api.sansekai.my.id/api/moviebox';
const RATE_MS = 2500;
let _last = 0;

async function api(path, retries = 2) {
    const wait = RATE_MS - (Date.now() - _last);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _last = Date.now();
    try {
        const res = await axios.get(BASE + path, { timeout: 20000 });
        return res.data;
    } catch (err) {
        if (err.response?.status === 429 && retries > 0) {
            // Rate limited — wait longer and retry
            const delay = (3 - retries) * 4000 + 3000; // 3s, 7s
            console.warn(`[moviebox] 429 on ${path.split('?')[0]}, retry in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
            _last = Date.now();
            return api(path, retries - 1);
        }
        throw err;
    }
}

async function getTrending(page = 0) { return api(`/trending?page=${page}`); }
async function search(query, page = 1) { return api(`/search?query=${encodeURIComponent(query)}&page=${page}`); }
async function getDetail(subjectId) { return api(`/detail?subjectId=${subjectId}`); }
async function getSources(subjectId) { return api(`/sources?subjectId=${subjectId}`); }
async function getEpisodeSources(subjectId, season, episode) {
    return api(`/sources?subjectId=${subjectId}&season=${season}&episode=${episode}`);
}

// Try multiple cache-key variants to find the freshest URL
// sansekai caches per URL — different params = different cache entries
async function getEpisodeSourcesBest(subjectId, season, episode) {
    const variants = [
        `/sources?subjectId=${subjectId}&season=${season}&episode=${episode}`,
        `/sources?subjectId=${subjectId}&season=${season}&episode=${episode}&lang=zh`,
        `/sources?subjectId=${subjectId}&season=${season}&episode=${episode}&resolution=360`,
    ];

    let best = null;
    let bestAge = Infinity;
    const now = Math.floor(Date.now() / 1000);

    for (const path of variants) {
        try {
            const data = await api(path);
            const sources = parseSources(data);
            if (!sources.length) continue;
            const t = sources[0].url?.match(/[?&]t=(\d+)/)?.[1];
            const age = t ? now - parseInt(t) : Infinity;
            if (age < bestAge) {
                bestAge = age;
                best = data;
                // Fresh enough (< 10 min) — no need to try more
                if (age < 600) break;
            }
        } catch (e) {
            console.warn(`[moviebox/best] variant failed: ${e.message}`);
        }
    }
    if (!best) throw new Error('Semua sumber gagal');
    return best;
}

function parseItems(data) {
    const raw = data?.items || data?.list || [];
    return raw.filter(i => i.subjectId).map(i => ({
        _source: 'moviebox',
        key: i.subjectId,
        title: i.title || '',
        cover: i.cover?.url || i.thumbnail || null,
        desc: i.description || '',
        genre: i.genre || '',
        country: i.countryName || '',
        imdb: i.imdbRatingValue || '',
        duration: i.duration || 0,
        subjectType: i.subjectType || 1,
        hasResource: i.hasResource !== false,
    }));
}

function parseSources(data) {
    return (data?.processedSources || [])
        .filter(s => s.directUrl && s.quality)
        .sort((a, b) => a.quality - b.quality)
        .map(s => ({
            quality: s.quality,
            url: s.directUrl,
            sizeMB: Math.round(parseInt(s.size || '0') / 1024 / 1024),
        }));
}

module.exports = { getTrending, search, getDetail, getSources, getEpisodeSources, getEpisodeSourcesBest, parseItems, parseSources };
