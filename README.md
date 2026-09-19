# 🇩🇰 Danish Nuvio Catalog

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Built for Nuvio](https://img.shields.io/badge/built%20for-Nuvio-e21d35)](https://nuvioapp.space/)
[![Deploy](https://img.shields.io/badge/deploy-Render-5f45ba?logo=render&logoColor=white)](https://render.com)
[![License: proprietary](https://img.shields.io/badge/license-all%20rights%20reserved-lightgrey)](#license)

A catalog and metadata addon for [Nuvio](https://nuvioapp.space/), focused
entirely on Danish movies and TV series — 19 curated catalogs covering
genres, popularity, ratings, and release periods, plus search.

> **This is a catalog addon, not a stream addon.** It provides catalog
> entries and metadata only. It does **not** provide video streams — a
> separate stream source is required for playback in Nuvio.

## Contents

- [Features](#features)
- [Available catalogs](#available-catalogs)
- [Install in Nuvio](#install-in-nuvio)
- [Configuration](#configuration)
- [Run locally](#run-locally)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [TMDB attribution](#tmdb-attribution)
- [License](#license)
- [Disclaimer](#disclaimer)

## Features

- 19 curated Danish catalogs across movies and series
- TMDB-powered metadata: posters, backdrops, cast, directors, trailers
- Danish-only filtering by origin country and original language
- Free-text search, scoped to Danish titles
- Configurable installs — pick exactly which catalogs you want via the
  web installer
- In-memory response caching to minimize TMDB API usage
- Date-based catalogs (e.g. "new releases") are resolved on every
  request, so they never go stale between deploys

## Available catalogs

| Catalog | Type | Description |
|---|---|---|
| 🇩🇰 Danske film | Movie | All Danish movies |
| 🇩🇰 Danske serier | Series | All Danish series |
| 🔥 Nye danske film | Movie | Danish movies released since 2020 |
| 🔥 Nye danske serier | Series | Danish series first aired since 2020 |
| ⭐ Populære danske film | Movie | Popular Danish movies |
| ⭐ Populære danske serier | Series | Popular Danish series |
| 🏆 Bedst bedømte danske film | Movie | Highest-rated Danish movies |
| 🏆 Bedst bedømte danske serier | Series | Highest-rated Danish series |
| 🎬 Danske klassikere | Movie | Danish movies released before 2000 |
| 📼 Danske klassiske serier | Series | Danish series first aired before 2000 |
| 😂 Danske komedier | Movie | Danish comedy movies |
| 😂 Danske komedieserier | Series | Danish comedy series |
| 🔪 Danske krimier | Movie | Danish crime movies |
| 🔪 Danske krimiserier | Series | Danish crime series |
| 🎭 Danske dramaer | Movie | Danish drama movies |
| 🎭 Danske dramaserier | Series | Danish drama series |
| 📅 Danske film 2020–nu | Movie | Danish movies from 2020 onward, newest first |
| 📅 Danske film 2000–2019 | Movie | Danish movies from 2000–2019 |
| 📼 Danske film før 2000 | Movie | Danish movies released before 2000 |

Danish content is identified using TMDB's origin-country (`DK`) and
original-language (`da`) filters. Date-based catalogs are evaluated
against the current date on every request — no yearly maintenance
required.

## Install in Nuvio

1. Open the addon's homepage (your deployed URL).
2. Either copy the standard installation link, or use **Customize
   catalogs** to select only the catalogs you want.
3. Open Nuvio and go to addon installation.
4. Paste the manifest URL and install.

The manifest is also available directly at `/manifest.json`.

## Configuration

The addon requires one environment variable:

```text
TMDB_API_KEY=YOUR_TMDB_API_KEY
```

Optionally, set the public URL of the deployed addon (useful if it runs
behind a proxy that doesn't forward the original host/protocol):

```text
PUBLIC_BASE_URL=https://your-domain.example
```

Keep your TMDB API key private. Do not commit it to the repository or
share it publicly.

## Run locally

Install dependencies:

```bash
npm install
```

Start the server:

```bash
TMDB_API_KEY=YOUR_TMDB_API_KEY npm start
```

The addon will be available at:

```text
http://localhost:7000/manifest.json
```

## Deployment

The project is configured for [Render](https://render.com) via
`render.yaml`, and works on any Node.js-compatible hosting provider.

| Setting | Value |
|---|---|
| Build command | `npm install` |
| Start command | `npm start` |
| Required env var | `TMDB_API_KEY` |
| Optional env var | `PUBLIC_BASE_URL` |

After deployment, the manifest is available at:

```text
https://YOUR-DOMAIN/manifest.json
```

## Project structure

```text
.
├── server.js       Express server, addon logic, and the web installer page
├── package.json    Dependencies and start script
├── render.yaml      Render deployment configuration
└── README.md        This file
```

## Architecture

Built with:

- **Node.js** + **Express**
- **TMDB API** for metadata
- The addon protocol Nuvio uses for catalogs and metadata, implemented
  via the `stremio-addon-sdk` library — the protocol is shared across
  compatible clients, which is why the dependency carries that name

Catalog and metadata responses are cached in memory (15 minutes for
catalog pages, 60 minutes for detailed metadata) to reduce redundant
TMDB requests.

## TMDB attribution

This project uses the TMDB API but is not endorsed or certified by
TMDB.

## License

No open-source license has currently been declared for this project.
Unless a license is added to the repository, the project should be
treated as **all rights reserved**.

## Disclaimer

This project is an independent community project and is not affiliated
with or endorsed by Nuvio or TMDB.
