const startTime = Date.now();

const counts = {
    total: 0,
    freereels: 0,
    reelshort: 0,
    melolo: 0,
    errors: 0,
    downloads: 0,
    streams: 0,
};

const recentActivity = [];

function trackCommand(opts = {}) {
    const { platform = null, user = 'unknown', action = '', title = '', result = 'ok' } = opts;
    counts.total++;
    if (platform && counts[platform] !== undefined) counts[platform]++;
    if (result === 'error') counts.errors++;
    if (result === 'download') counts.downloads++;
    if (result === 'stream') counts.streams++;

    recentActivity.unshift({
        time: Date.now(),
        user,
        platform: platform || '-',
        action,
        title: title ? title.slice(0, 40) : '',
        result,
    });
    if (recentActivity.length > 100) recentActivity.pop();
}

function getStats() {
    const uptimeMs = Date.now() - startTime;
    const s = Math.floor(uptimeMs / 1000);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const uptimeStr = days > 0
        ? `${days}d ${hours}h ${mins}m`
        : hours > 0
            ? `${hours}h ${mins}m ${secs}s`
            : `${mins}m ${secs}s`;

    return {
        uptimeMs,
        uptimeStr,
        startTime,
        counts: { ...counts },
        recentActivity: recentActivity.slice(0, 50),
    };
}

module.exports = { trackCommand, getStats };
