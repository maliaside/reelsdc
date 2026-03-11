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

// Get episode sources — tries second variant if first returns a stale/expired URL
async function getEpisodeSourcesBest(subjectId, season, episode) {
    const data = await getEpisodeSources(subjectId, season, episode);
    const sources = parseSources(data);
    if (!sources.length) throw new Error('Tidak ada sumber video tersedia');

    const now = Math.floor(Date.now() / 1000);
    const age = urlAge(sources[0].url, now);

    // If URL is very fresh (<10 min) via proxy, return immediately
    if (age < 600) return data;

    // Stale — try a second variant to bust sansekai cache
    console.warn(`[moviebox/best] First URL ${age}s old, trying variant...`);
    try {
        const res2 = await client.get(`${BASE}/sources`, { params: { subjectId, season, episode, lang: 'zh' } });
        const src2 = parseSources(res2.data);
        if (src2.length && urlAge(src2[0].url, now) < age) return res2.data;
    } catch (e) {
        console.warn('[moviebox/best] variant failed:', e.message);
    }
    return data; // return whatever we have
}

function urlAge(url, now) {
    if (!now) now = Math.floor(Date.now() / 1000);
    const t = url?.match(/[?&]t=(\d+)/)?.[1];
    return t ? now - parseInt(t) : 0;
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

module.exports = { getTrending, search, getDetail, getSources, getEpisodeSources, getEpisodeSourcesBest, parseItems, parseSources, urlAge };
