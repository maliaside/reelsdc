# Discord Bot - FreeReels + ReelShort

Bot Discord 24/7 yang mengambil konten drama dari FreeReels dan ReelShort. Video episode diunduh dan dikirim sebagai mp4 langsung ke Discord untuk diputar.

## Struktur Project

```
index.js                  # Entry point - Discord bot + web server
src/
  api/
    freereels.js          # Wrapper API Sansekai FreeReels
    reelshort.js          # Wrapper API Sansekai ReelShort
  commands/
    freereels.js          # Slash command /freereels
    reelshort.js          # Slash command /reelshort
    cari.js               # Slash command /cari (search lintas platform)
  video.js                # Download HLS episode ke mp4 via ffmpeg (FreeReels + ReelShort)
  webserver.js            # Express server port 5000 (health check)
  player.html             # Fallback web player (hls.js)
  deploy-commands.js      # Daftarkan slash commands ke Discord
package.json
```

## Slash Commands

| Command | Deskripsi |
|---------|-----------|
| `/freereels foryou [offset]` | Daftar drama For You FreeReels |
| `/freereels homepage` | Drama dari beranda FreeReels |
| `/freereels anime` | Daftar anime FreeReels |
| `/freereels cari <judul>` | Cari drama di FreeReels (filter lokal multi-offset) |
| `/freereels detail <key>` | Detail drama FreeReels berdasarkan KEY |
| `/reelshort foryou [offset]` | Daftar drama For You ReelShort |
| `/reelshort homepage` | Drama dari beranda ReelShort |
| `/reelshort cari <judul>` | Cari drama di ReelShort (search API aktif, 372+ drama) |
| `/reelshort detail <bookid>` | Detail drama ReelShort berdasarkan bookId |
| `/cari <judul>` | **Cari di FreeReels + ReelShort sekaligus** |

## Alur Menonton

### FreeReels
1. `/freereels foryou` → kartu drama + tombol **📋 Detail & Tonton**
2. Klik tombol → detail drama + dropdown episode
3. Pilih episode → bot download (20-60 detik) → mp4 dikirim ke Discord
4. Subtitle Indonesia otomatis di-burn ke video (audio Mandarin)

### ReelShort
1. `/reelshort foryou` atau `/cari <judul>` → kartu drama
2. Klik **📋 Detail & Tonton** → daftar episode (locked/free)
3. Pilih episode gratis → download (10-30 detik) → mp4 dikirim ke Discord
4. Audio sudah embedded (TS stream), ~3-5MB per episode

## Platform Details

### FreeReels
- Video: HLS (fMP4/CMAF) dari mydramawave.com
- Butuh Referer/Origin header untuk akses video
- Audio terpisah (EXT-X-MEDIA aac.m3u8) - audio Mandarin
- Indonesian subtitle dari subtitle_list (id-ID, SRT format) di-burn ke video
- Ukuran file target: <7MB (dynamic bitrate calculation dari duration)

### ReelShort  
- Video: HLS (TS segments) dari crazymaplestudios.com
- Tidak butuh auth headers
- Audio embedded dalam TS segments
- Tersedia kualitas: 360p, 540p, 720p (pilih H264 360p untuk Discord)
- Search API berfungsi penuh (~372+ drama tersedia)
- Ukuran file: ~3-5MB per episode

## API Endpoints

```
https://api.sansekai.my.id/api/freereels/
  foryou?offset=N
  homepage
  animepage
  detailAndAllEpisode?key=KEY

https://api.sansekai.my.id/api/reelshort/
  foryou?offset=N
  homepage
  search?query=Q&page=1
  detail?bookId=BOOKID
  episode?bookId=BOOKID&episodeNumber=N
```

## Environment Variables / Secrets

- `DISCORD_BOT_TOKEN` - Token bot dari Discord Developer Portal
- `DISCORD_APPLICATION_ID` - Application ID dari Discord Developer Portal

## Menjalankan

```bash
node index.js                 # Jalankan bot + web server
node src/deploy-commands.js   # Daftarkan ulang slash commands
```

## Stack

- Node.js 20
- discord.js v14
- express (port 5000)
- axios
- ffmpeg dengan libass (system dependency) - untuk burn subtitle SRT
