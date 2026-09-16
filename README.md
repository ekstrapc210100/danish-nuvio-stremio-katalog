# Danish Nuvio/Stremio Katalog

Dette er et **katalog-addon**, ikke et stream-addon. Det laver separate rækker/kataloger i Stremio/Nuvio baseret på TMDB.

## Kataloger

- 🇩🇰 Danske film
- 🇩🇰 Danske serier
- 🎬 Danske klassikere
- 😂 Danske komedier
- 🔪 Danske krimier
- 📅 Danske film 2020–2026
- 📅 Danske film 2000–2019
- 📼 Danske film før 2000

Filtreringen bruger TMDB's `with_origin_country=DK`, så "Danmark" betyder produktions-/oprindelsesland og ikke bare dansk release-region.

## Du skal bruge

- Node.js 20+
- En TMDB API Key

**Send ikke din API-nøgle til andre.** Læg den som en miljøvariabel på den server, hvor addon'et hostes:

`TMDB_API_KEY=DIN_TMDB_API_KEY`

## Kør lokalt

```bash
npm install
TMDB_API_KEY=DIN_NØGLE npm start
```

Addon'et kører derefter på:

`http://localhost:7000/manifest.json`

Nuvio/Stremio skal normalt bruge en offentligt tilgængelig HTTPS-adresse, hvis addon'et skal bruges fra telefon/TV.

## Hosting

Du kan fx hoste projektet på Render, Railway, Fly.io, en VPS eller en anden Node-kompatibel host.

Sæt:

- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `TMDB_API_KEY`

Når serveren er online, er manifestet:

`https://DIN-DOMÆNE/manifest.json`

Kopiér manifest-adressen ind i Nuvio.

## Vigtigt

Dette addon leverer **katalogdata og metadata-preview**. Det leverer ikke selve videostreams. Et separat stream-addon skal stadig levere en stream, hvis du vil afspille titlerne.
