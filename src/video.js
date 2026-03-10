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

const FFMPEG_HEADERS = 'Referer: https://m.mydramawave.com/\r\nOrigin: https://m.mydramawave.com\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36\r\n';

async function parseMasterM3u8(masterUrl) {
    const res = await axios.get(masterUrl, { headers: VIDEO_HEADERS, responseType: 'text' });
    const lines = res.data.split('\n');
    const baseUrl = masterUrl.replace(/\/[^/]+\.m3u8.*$/, '/');

    let audioRelUrl = null;
    const videoStreams = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('#EXT-X-MEDIA') && line.includes('TYPE=AUDIO')) {
            const uriMatch = line.match(/URI="([^"]+)"/);
            if (uriMatch) audioRelUrl = uriMatch[1];
        }

        if (line.startsWith('#EXT-X-STREAM-INF')) {
            const bwMatch = line.match(/BANDWIDTH=(\d+)/);
            const urlLine = lines[i + 1]?.trim();
            if (urlLine && !urlLine.startsWith('#')) {
                videoStreams.push({
                    bandwidth: parseInt(bwMatch?.[1] || '0'),
                    url: urlLine.startsWith('http') ? urlLine : baseUrl + urlLine
                });
            }
        }
    }

    videoStreams.sort((a, b) => a.bandwidth - b.bandwidth);
    const lowestVideoUrl = videoStreams[0]?.url || masterUrl;
    const audioUrl = audioRelUrl ? (audioRelUrl.startsWith('http') ? audioRelUrl : baseUrl + audioRelUrl) : null;

    return { lowestVideoUrl, audioUrl };
}

async function downloadSubtitle(subtitleUrl) {
    if (!subtitleUrl) return null;
    try {
        const res = await axios.get(subtitleUrl, { responseType: 'text', timeout: 10000 });
        const srtPath = path.join(os.tmpdir(), `freereels_sub_${Date.now()}.srt`);
        fs.writeFileSync(srtPath, res.data, 'utf8');
        console.log('[video] Subtitle downloaded:', srtPath);
        return srtPath;
    } catch (err) {
        console.warn('[video] Subtitle download failed:', err.message);
        return null;
    }
}

async function downloadEpisodeToFile(masterM3u8Url, subtitleUrl = null) {
    const { lowestVideoUrl, audioUrl } = await parseMasterM3u8(masterM3u8Url);
    const tmpFile = path.join(os.tmpdir(), `freereels_${Date.now()}.mp4`);
    let srtPath = null;

    console.log('[video] Video URL:', lowestVideoUrl);
    console.log('[video] Audio URL:', audioUrl);
    console.log('[video] Subtitle URL:', subtitleUrl || 'none');

    srtPath = await downloadSubtitle(subtitleUrl);

    let ffmpegArgs;

    if (srtPath) {
        // Re-encode with burned-in Indonesian subtitles
        // Escape path for ffmpeg subtitle filter (escape colons and backslashes)
        const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

        if (audioUrl) {
            ffmpegArgs = [
                '-y',
                '-allowed_extensions', 'ALL',
                '-headers', FFMPEG_HEADERS,
                '-i', lowestVideoUrl,
                '-allowed_extensions', 'ALL',
                '-headers', FFMPEG_HEADERS,
                '-i', audioUrl,
                '-map', '0:v:0',
                '-map', '1:a:0',
                '-vf', `subtitles=${escapedSrt}:force_style='FontName=Arial,FontSize=14,PrimaryColour=&Hffffff,OutlineColour=&H000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,Alignment=2'`,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '30',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
                tmpFile
            ];
        } else {
            ffmpegArgs = [
                '-y',
                '-allowed_extensions', 'ALL',
                '-headers', FFMPEG_HEADERS,
                '-i', lowestVideoUrl,
                '-map', '0:v:0',
                '-map', '0:a:0',
                '-vf', `subtitles=${escapedSrt}:force_style='FontName=Arial,FontSize=14,PrimaryColour=&Hffffff,OutlineColour=&H000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,Alignment=2'`,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '30',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
                tmpFile
            ];
        }
    } else if (audioUrl) {
        // Copy without re-encoding (no subtitle)
        ffmpegArgs = [
            '-y',
            '-allowed_extensions', 'ALL',
            '-headers', FFMPEG_HEADERS,
            '-i', lowestVideoUrl,
            '-allowed_extensions', 'ALL',
            '-headers', FFMPEG_HEADERS,
            '-i', audioUrl,
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-c', 'copy',
            '-movflags', '+faststart',
            tmpFile
        ];
    } else {
        ffmpegArgs = [
            '-y',
            '-allowed_extensions', 'ALL',
            '-headers', FFMPEG_HEADERS,
            '-i', lowestVideoUrl,
            '-c', 'copy',
            '-movflags', '+faststart',
            tmpFile
        ];
    }

    try {
        await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 180_000 });
    } finally {
        if (srtPath) { try { fs.unlinkSync(srtPath); } catch (_) {} }
    }

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
