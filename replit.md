# Discord Bot - FreeReels

Bot Discord yang mengambil konten dari API Sansekai (FreeReels) menggunakan slash commands.

## Struktur Project

```
index.js                  # Entry point bot Discord
src/
  api/
    freereels.js          # Wrapper untuk API Sansekai FreeReels
  commands/
    freereels.js          # Slash command /freereels dengan subcommands
  deploy-commands.js      # Script untuk mendaftarkan slash commands ke Discord
package.json
```

## Slash Commands

| Command | Deskripsi |
|---------|-----------|
| `/freereels foryou [page]` | Daftar drama For You (dengan navigasi) |
| `/freereels homepage` | Drama dari halaman utama FreeReels |
| `/freereels anime [page]` | Daftar anime FreeReels |
| `/freereels cari <judul>` | Cari drama berdasarkan judul |
| `/freereels detail <id>` | Detail drama berdasarkan ID |

## API

Menggunakan https://api.sansekai.my.id/api dengan endpoint:
- `/freereels/foryou`
- `/freereels/homepage`
- `/freereels/animepage`
- `/freereels/search`
- `/freereels/detailAndAllEpisode`

## Environment Variables / Secrets

- `DISCORD_BOT_TOKEN` - Token bot dari Discord Developer Portal
- `DISCORD_APPLICATION_ID` - Application ID dari Discord Developer Portal

## Menjalankan

```bash
node index.js        # Jalankan bot
node src/deploy-commands.js   # Daftarkan ulang slash commands
```

## Stack

- Node.js 20
- discord.js v14
- axios
- @discordjs/rest
