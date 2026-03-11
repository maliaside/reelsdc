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

// Simple wrapper — just fetch and return.
// No "freshness" check: CDN URLs (bcdnxw.hakunaymatata.com) stay valid for hours.
// The "try variant" logic triggered extra 429 rate limits with no benefit.
async function getEpisodeSourcesBest(subjectId, season, episode) {
    const data = await getEpisodeSources(subjectId, season, episode);
    const sources = parseSources(data);
    if (!sources.length) throw new Error('Episode ini tidak tersedia atau terkunci.');
    return data;
}

function urlAge(url, now) {
    if (!now) now = Math.floor(Date.now() / 1000);
    const t = url?.match(/[?&]t=(\d+)/)?.[1];
    return t ? now - parseInt(t) : 0;
}

function parseItems(data) {
    const raw = data?.data?.items || data?.items || data?.list || [];
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
