// discover.js — Automatic discovery of Danish movies & series.
//
// Builds a persistent catalog in Postgres (Neon) instead of relying purely
// on live per-request TMDB calls. Can run two ways:
//   1. As a standalone script:  node discover.js
//   2. Imported and called from server.js's /internal/discover endpoint,
//      which is what a free scheduled trigger (GitHub Actions) hits daily —
//      this project has no paid Render Cron Job, so the discovery logic
//      lives inside the always-available web service instead.
//
// Env vars required: TMDB_API_KEY, DATABASE_URL
//
// Paging strategy: TMDB discover is sorted newest-first. Every run always
// re-checks page 1 (to catch brand-new releases immediately), then walks
// forward through older pages using a cursor persisted in
// discovery_state(next_page), wrapping back to page 2 once it reaches the
// end. This way the database gradually backfills the *entire* historical
// catalog over many runs instead of re-fetching the same newest slice
// forever.

const { Client } = require("pg");

const TMDB_BASE = "https://api.themoviedb.org/3";

// How many *additional* (non-page-1) pages to pull per type, per run, on
// top of always refreshing page 1. TMDB returns 20 results/page.
const DEFAULT_PAGES_PER_RUN = 6;

// Minimum time between runs, to keep the endpoint safe to expose without a
// secret: hitting it more often than this just returns the last result
// instead of doing real work again.
const MIN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function tmdbFetch(apiKey, path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function loadGenreMap(apiKey, mediaType) {
  const data = await tmdbFetch(apiKey, `/genre/${mediaType}/list`, { language: "da-DK" });
  const map = new Map();
  for (const g of data.genres || []) map.set(g.id, g.name);
  return map;
}

function mapItem(item, type, genreMap) {
  const releaseDate = type === "movie" ? item.release_date : item.first_air_date;
  const year = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) : null;
  const title = type === "movie" ? item.title : item.name;
  const originalTitle = type === "movie" ? item.original_title : item.original_name;
  const genres = (item.genre_ids || []).map((id) => genreMap.get(id)).filter(Boolean);
  return {
    tmdb_id: item.id,
    type,
    title,
    original_title: originalTitle || null,
    year,
    release_date: releaseDate || null,
    overview: item.overview || null,
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    vote_average: item.vote_average ?? null,
    vote_count: item.vote_count ?? null,
    popularity: item.popularity ?? null,
    genres,
    origin_countries: item.origin_country || [],
    original_language: item.original_language || null,
    raw_data: item
  };
}

/**
 * Fetches page 1 (always, to catch new releases) plus `pagesPerRun` more
 * pages starting at `startPage` (wrapping back to page 2 if it runs past
 * the end — page 1 is already covered separately). Returns the mapped
 * items and where the cursor should start next time.
 */
async function discoverType(apiKey, type, startPage, pagesPerRun) {
  const mediaType = type === "movie" ? "movie" : "tv";
  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
  const genreMap = await loadGenreMap(apiKey, mediaType);

  async function fetchPage(page) {
    return tmdbFetch(apiKey, `/discover/${mediaType}`, {
      with_origin_country: "DK",
      with_original_language: "da",
      sort_by: `${dateField}.desc`,
      include_adult: "false",
      page: String(page),
      language: "da-DK"
    });
  }

  const items = [];

  // Always refresh page 1 so brand-new releases show up the same day.
  const first = await fetchPage(1);
  items.push(...(first.results || []));
  const totalPages = first.total_pages || 1;

  let cursor = Math.min(Math.max(startPage, 2), Math.max(totalPages, 2));
  let pagesFetched = 0;

  while (pagesFetched < pagesPerRun && totalPages > 1) {
    const data = await fetchPage(cursor);
    items.push(...(data.results || []));
    pagesFetched++;
    cursor++;
    if (cursor > totalPages) cursor = 2; // wrap, skipping page 1 (already covered)
  }

  return {
    items: items.map((item) => mapItem(item, type, genreMap)),
    nextPage: cursor,
    totalPages
  };
}

async function bulkUpsert(client, titles) {
  if (titles.length === 0) return { created: 0, updated: 0 };

  const payload = JSON.stringify(titles);
  const result = await client.query(
    `WITH incoming AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         tmdb_id INTEGER, type TEXT, title TEXT, original_title TEXT,
         year INTEGER, release_date TEXT, overview TEXT, poster_path TEXT,
         backdrop_path TEXT, vote_average NUMERIC, vote_count INTEGER,
         popularity NUMERIC, genres JSONB, origin_countries JSONB,
         original_language TEXT, raw_data JSONB
       )
     ),
     upserted AS (
       INSERT INTO titles (
         tmdb_id, type, title, original_title, year, release_date, overview,
         poster_path, backdrop_path, vote_average, vote_count, popularity,
         genres, origin_countries, original_language, danish_verified, source,
         last_updated_at, raw_data
       )
       SELECT
         tmdb_id, type, title, original_title, year,
         NULLIF(release_date, '')::date, overview, poster_path, backdrop_path,
         vote_average, vote_count, popularity, genres, origin_countries,
         original_language, true, 'tmdb_discover', now(), raw_data
       FROM incoming
       ON CONFLICT (tmdb_id, type) DO UPDATE SET
         title = EXCLUDED.title,
         original_title = EXCLUDED.original_title,
         year = EXCLUDED.year,
         release_date = EXCLUDED.release_date,
         overview = EXCLUDED.overview,
         poster_path = EXCLUDED.poster_path,
         backdrop_path = EXCLUDED.backdrop_path,
         vote_average = EXCLUDED.vote_average,
         vote_count = EXCLUDED.vote_count,
         popularity = EXCLUDED.popularity,
         genres = EXCLUDED.genres,
         origin_countries = EXCLUDED.origin_countries,
         original_language = EXCLUDED.original_language,
         last_updated_at = now(),
         raw_data = EXCLUDED.raw_data
       RETURNING (xmax = 0) AS inserted
     )
     SELECT
       count(*) FILTER (WHERE inserted) AS created,
       count(*) FILTER (WHERE NOT inserted) AS updated
     FROM upserted`,
    [payload]
  );
  const row = result.rows[0];
  return { created: Number(row.created), updated: Number(row.updated) };
}

async function getCursor(client, type) {
  const res = await client.query(
    `INSERT INTO discovery_state (type, next_page) VALUES ($1, 2)
     ON CONFLICT (type) DO NOTHING
     RETURNING next_page`,
    [type]
  );
  if (res.rows[0]) return res.rows[0].next_page;
  const existing = await client.query(
    `SELECT next_page FROM discovery_state WHERE type = $1`,
    [type]
  );
  return existing.rows[0]?.next_page ?? 2;
}

async function setCursor(client, type, nextPage, totalPages) {
  await client.query(
    `UPDATE discovery_state SET next_page = $2, total_pages_seen = $3 WHERE type = $1`,
    [type, nextPage, totalPages]
  );
}

/**
 * Runs one discovery pass and upserts results into Postgres.
 * Skips the work (returns the previous run's summary) if the last run was
 * more recent than MIN_INTERVAL_MS, so this is safe to expose as a public
 * endpoint without a secret.
 */
async function runDiscovery({ apiKey, databaseUrl, pagesPerRun = DEFAULT_PAGES_PER_RUN, force = false } = {}) {
  if (!apiKey) throw new Error("Missing TMDB API key");
  if (!databaseUrl) throw new Error("Missing database URL");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    if (!force) {
      const last = await client.query(
        `SELECT id, started_at, finished_at, status, titles_found, titles_new, titles_updated
         FROM discovery_runs ORDER BY id DESC LIMIT 1`
      );
      const lastRun = last.rows[0];
      if (lastRun && Date.now() - new Date(lastRun.started_at).getTime() < MIN_INTERVAL_MS) {
        return { skipped: true, reason: "ran recently", lastRun };
      }
    }

    const runResult = await client.query(
      `INSERT INTO discovery_runs (status) VALUES ('running') RETURNING id`
    );
    const runId = runResult.rows[0].id;

    try {
      const movieStart = await getCursor(client, "movie");
      const seriesStart = await getCursor(client, "series");

      const [movies, series] = await Promise.all([
        discoverType(apiKey, "movie", movieStart, pagesPerRun),
        discoverType(apiKey, "series", seriesStart, pagesPerRun)
      ]);

      await setCursor(client, "movie", movies.nextPage, movies.totalPages);
      await setCursor(client, "series", series.nextPage, series.totalPages);

      const all = [...movies.items, ...series.items];
      const { created, updated } = await bulkUpsert(client, all);

      await client.query(
        `UPDATE discovery_runs
         SET finished_at = now(), titles_found = $2, titles_new = $3,
             titles_updated = $4, status = 'success'
         WHERE id = $1`,
        [runId, all.length, created, updated]
      );

      return {
        skipped: false,
        runId,
        moviesSeen: movies.items.length,
        seriesSeen: series.items.length,
        titlesFound: all.length,
        created,
        updated,
        movieCursor: { next: movies.nextPage, totalPages: movies.totalPages },
        seriesCursor: { next: series.nextPage, totalPages: series.totalPages }
      };
    } catch (err) {
      await client.query(
        `UPDATE discovery_runs SET finished_at = now(), status = 'error', error = $2 WHERE id = $1`,
        [runId, String(err.message || err)]
      );
      throw err;
    }
  } finally {
    await client.end();
  }
}

module.exports = { runDiscovery };

if (require.main === module) {
  runDiscovery({
    apiKey: process.env.TMDB_API_KEY,
    databaseUrl: process.env.DATABASE_URL,
    pagesPerRun: parseInt(process.env.DISCOVERY_PAGES || "15", 10),
    force: true
  })
    .then((summary) => {
      console.log("Discovery summary:", summary);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Discovery run failed:", err);
      process.exit(1);
    });
}
