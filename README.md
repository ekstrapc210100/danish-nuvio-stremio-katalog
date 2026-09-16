# Danish Nuvio / Stremio Catalog

A catalog and metadata addon for [Nuvio](https://nuvioapp.space/) and
Stremio, focused on Danish movies and TV series.

> **This is a catalog addon, not a stream addon.** It provides catalog
> entries and metadata. It does not provide video streams.

## Features

-   Danish movies and TV series
-   TMDB-powered metadata
-   Separate catalogs for genres, popularity, ratings and release
    periods
-   Search support
-   Detailed metadata including posters, backdrops, cast, directors and
    trailers
-   Configurable catalog selection
-   In-memory caching to reduce repeated TMDB requests
-   Designed for deployment on services such as Render

## Available catalogs

  Catalog                     Description
  --------------------------- ------------------------------------------
  Danish Movies               Danish movies
  Danish Series               Danish TV series
  Danish New Releases         Recent Danish movies
  Danish Popular              Popular Danish titles
  Danish Top Rated            Highly rated Danish titles
  Danish Classics             Danish classic movies
  Danish Comedies             Danish comedy movies
  Danish Crime                Danish crime movies
  Danish Drama                Danish drama movies
  Danish Movies 2020--2026    Danish movies released from 2020 to 2026
  Danish Movies 2000--2019    Danish movies released from 2000 to 2019
  Danish Movies before 2000   Danish movies released before 2000

The addon uses TMDB country and language filters to identify Danish
content.

## Requirements

-   Node.js 20 or newer
-   A TMDB API key
-   A server with a publicly accessible HTTPS URL for normal
    Nuvio/Stremio use

## Configuration

The addon requires the following environment variable:

``` text
TMDB_API_KEY=YOUR_TMDB_API_KEY
```

Optionally, set the public URL of the deployed addon:

``` text
PUBLIC_BASE_URL=https://your-domain.example
```

Keep your TMDB API key private. Do not commit it to GitHub or share it
publicly.

## Run locally

Clone the repository and install the dependencies:

``` bash
npm install
```

Start the server:

``` bash
TMDB_API_KEY=YOUR_TMDB_API_KEY npm start
```

The addon will be available at:

``` text
http://localhost:7000/manifest.json
```

## Deployment

The project can be deployed to Render or another Node.js-compatible
hosting provider.

Typical settings:

-   **Build command:** `npm install`
-   **Start command:** `npm start`
-   **Environment variable:** `TMDB_API_KEY`
-   **Optional environment variable:** `PUBLIC_BASE_URL`

After deployment, the manifest will normally be available at:

``` text
https://YOUR-DOMAIN/manifest.json
```

Use the manifest URL when installing the addon in Nuvio or Stremio.

## Architecture

The addon is built with:

-   **Node.js**
-   **Express**
-   **stremio-addon-sdk**
-   **TMDB API**

Catalog responses and metadata are cached in memory to reduce
unnecessary API requests.

## TMDB

This project uses data from TMDB.

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Important notes

This addon provides catalog and metadata information only. It does
**not** provide movie or TV streams.

A separate stream provider or stream addon is required for playback.

## License

No open-source license has currently been declared for this project.
Unless a license is added to the repository, the project should be
treated as **all rights reserved**.

## Disclaimer

This project is an independent community project and is not affiliated
with or endorsed by Nuvio, Stremio or TMDB.
