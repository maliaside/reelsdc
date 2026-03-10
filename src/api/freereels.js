const axios = require('axios');

const BASE_URL = 'https://api.sansekai.my.id/api';

async function getForYou(offset = 0) {
    const res = await axios.get(`${BASE_URL}/freereels/foryou`, { params: { offset } });
    return res.data;
}

async function getHomepage() {
    const res = await axios.get(`${BASE_URL}/freereels/homepage`);
    return res.data;
}

async function getAnimePage() {
    const res = await axios.get(`${BASE_URL}/freereels/animepage`);
    return res.data;
}

async function search(query) {
    const res = await axios.get(`${BASE_URL}/freereels/search`, { params: { query } });
    return res.data;
}

async function getDetail(key) {
    const res = await axios.get(`${BASE_URL}/freereels/detailAndAllEpisode`, { params: { key } });
    return res.data;
}

module.exports = { getForYou, getHomepage, getAnimePage, search, getDetail };
