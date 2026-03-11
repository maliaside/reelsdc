const client = require('./client');

const BASE_URL = 'https://api.sansekai.my.id/api/reelshort';

async function getForYou(offset = 0) {
    const res = await client.get(`${BASE_URL}/foryou`, { params: { offset } });
    return res.data;
}

async function getHomepage() {
    const res = await client.get(`${BASE_URL}/homepage`);
    return res.data;
}

async function search(query, page = 1) {
    const res = await client.get(`${BASE_URL}/search`, { params: { query, page } });
    return res.data;
}

async function getDetail(bookId) {
    const res = await client.get(`${BASE_URL}/detail`, { params: { bookId } });
    return res.data;
}

async function getEpisodeVideo(bookId, episodeNumber) {
    const res = await client.get(`${BASE_URL}/episode`, { params: { bookId, episodeNumber } });
    return res.data;
}

module.exports = { getForYou, getHomepage, search, getDetail, getEpisodeVideo };
