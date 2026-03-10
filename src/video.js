const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

const execFileAsync = promisify(execFile);
const MAX_SIZE_BYTES = 24 * 1024 * 1024;

const VIDEO_HEADERS = {
    'Referer': 'https://m.mydramawave.com/',
    'Origin': 'https://m.mydramawave.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};

async function getLowestQualityUrl(masterM3u8Url) {
    const res = await axios.get(masterM3u8Url, { headers: VIDEO_HEADERS, responseType: 'text' });
    const lines = res.data.split('\n');
    const baseUrl = masterM3u8Url.replace(/\/[^/]+\.m3u8.*$/, '/');

    const streams = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF')) {
            const bwMatch = line.match(/BANDWIDTH=(\d+)/);
            const urlLine = lines[i + 1]?.trim();
            if (urlLine && !urlLine.startsWith('#')) {
                const absUrl = urlLine.startsWith('http') ? urlLine : baseUrl + urlLine;
                streams.push({ bandwidth: parseInt(bwMatch?.[1] || '0'), url: absUrl });
            }
        }
    }

    if (streams.length === 0) return masterM3u8Url;
    streams.sort((a, b) => a.bandwidth - b.bandwidth);
    return streams[0].url;
}

async function downloadEpisodeToFile(masterM3u8Url) {
    const subM3u8Url = await getLowestQualityUrl(masterM3u8Url);
    const tmpFile = path.join(os.tmpdir(), `freereels_${Date.now()}.mp4`);

    const ffmpegHeaders = `Referer: https://m.mydramawave.com/\r\nOrigin: https://m.mydramawave.com\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36\r\n`;

    await execFileAsync('ffmpeg', [
        '-y',
        '-headers', ffmpegHeaders,
        '-allowed_extensions', 'ALL',
        '-i', subM3u8Url,
        '-c', 'copy',
        '-movflags', '+faststart',
        tmpFile
    ], { timeout: 120_000 });

    const stat = fs.statSync(tmpFile);
    if (stat.size > MAX_SIZE_BYTES) {
        fs.unlinkSync(tmpFile);
        throw new Error(`Ukuran file terlalu besar (${Math.round(stat.size / 1024 / 1024)}MB). Melebihi batas Discord 24MB.`);
    }

    return { filePath: tmpFile, sizeBytes: stat.size };
}

function cleanup(filePath) {
    try { fs.unlinkSync(filePath); } catch (_) {}
}

module.exports = { downloadEpisodeToFile, cleanup };
