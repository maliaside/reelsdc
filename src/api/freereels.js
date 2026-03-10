const axios = require('axios');

const BASE_URL = 'https://api.sansekai.my.id/api';

async function getForYou(page = 1) {
    const res = await axios.get(`${BASE_URL}/freereels/foryou`, { params: { page } });
    return res.data;
}

async function getHomepage() {
    const res = await axios.get(`${BASE_URL}/freereels/homepage`);
    return res.data;
}

async function getAnimePage(page = 1) {
    const res = await axios.get(`${BASE_URL}/freereels/animepage`, { params: { page } });
    return res.data;
}

async function search(query) {
    const res = await axios.get(`${BASE_URL}/freereels/search`, { params: { q: query } });
    return res.data;
}

async function getDetail(id) {
    const res = await axios.get(`${BASE_URL}/freereels/detailAndAllEpisode`, { params: { id } });
    return res.data;
}

module.exports = { getForYou, getHomepage, getAnimePage, search, getDetail };
