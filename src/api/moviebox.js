const client = require('./client');

const BASE = 'https://api.sansekai.my.id/api/moviebox';

async function getTrending(page = 0) {
    const res = await client.get(`${BASE}/trending?page=${page}`);
    return res.data;
}

async function search(query, page = 1) {
    const res = await client.get(`${BASE}/search`, { params: { query, page } });
    return res.data;
}

async function getDetail(subjectId) {
    const res = await client.get(`${BASE}/detail`, { params: { subjectId } });
    return res.data;
}

async function getSources(subjectId) {
    const res = await client.get(`${BASE}/sources`, { params: { subjectId } });
    return res.data;
}

async function getEpisodeSources(subjectId, season, episode) {
    const res = await client.get(`${BASE}/sources`, { params: { subjectId, season, episode } });
    return res.data;
}

// Fetch sources, trying an alternate quality if the first URL is stale (> 25 min).
// Sansekai caches per quality so quality=720 and quality=360 have separate cache entries.
// CDN signed URLs appear to have ~30-60 min TTL, so we need reasonably fresh ones.
async function getEpisodeSourcesBest(subjectId, season, episode) {
    const data = await getEpisodeSources(subjectId, season, episode);
    const sources = parseSources(data);
    if (!sources.length) throw new Error('Episode ini tidak tersedia atau terkunci.');

    const now = Math.floor(Date.now() / 1000);
    const age = urlAge(sources[0].url, now);

    // If URL < 25 minutes old, return immediately
    if (age < 1500) return data;

    // Stale — try quality=720 as a different sansekai cache entry (often fresher)
    console.log(`[moviebox] URL ${age}s old, trying quality=720 cache entry...`);
    try {
        const res2 = await client.get(`${BASE}/sources`, {
            params: { subjectId, season, episode, quality: 720 }
        });
        const src2 = parseSources(res2.data);
        if (src2.length) {
            const age2 = urlAge(src2[0].url, now);
            console.log(`[moviebox] quality=720 URL age: ${age2}s (original: ${age}s)`);
            if (age2 < age) return res2.data; // use fresher one
        }
    } catch (e) {
        console.warn('[moviebox] quality=720 attempt failed:', e.message);
    }
    return data; // return whatever we have
}

function urlAge(url, now) {
    if (!now) now = Math.floor(Date.now() / 1000);
    const t = url?.match(/[?&]t=(\d+)/)?.[1];
    return t ? now - parseInt(t) : 0;
}

function parseItems(data) {
    const raw = data?.subjectList || data?.data?.items || data?.items || data?.list || [];
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
    const processed = (data?.processedSources || [])
        .filter(s => s.directUrl && s.quality)
        .map(s => ({
            quality: s.quality,
            url: s.directUrl,
            sizeMB: Math.round(parseInt(s.size || '0') / 1024 / 1024),
        }));
    const downloads = (data?.downloads || [])
        .filter(d => d.url && d.resolution)
        .map(d => ({
            quality: d.resolution,
            url: d.url,
            sizeMB: Math.round(parseInt(d.size || '0') / 1024 / 1024),
        }));
    const all = [...processed, ...downloads];
    const seen = new Set();
    return all.filter(s => { if (seen.has(s.quality)) return false; seen.add(s.quality); return true; })
        .sort((a, b) => a.quality - b.quality);
}

module.exports = { getTrending, search, getDetail, getSources, getEpisodeSources, getEpisodeSourcesBest, parseItems, parseSources, urlAge };
