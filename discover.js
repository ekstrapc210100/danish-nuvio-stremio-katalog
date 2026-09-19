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

const { Client } = require("pg");

const TMDB_BASE = "https://api.themoviedb.org/3";

// How many discover pages to pull per type, per run. TMDB returns 20
// results/page. Running roughly daily, this keeps well within TMDB's rate
// limits while gradually building full historical coverage and always
// re-checking the newest releases (which change most often).
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

async function discoverType(apiKey, type, pagesPerRun) {
  const mediaType = type === "movie" ? "movie" : "tv";
  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
  const genreMap = await loadGenreMap(apiKey, mediaType);

  const items = [];
  for (let page = 1; page <= pagesPerRun; page++) {
    const data = await tmdbFetch(apiKey, `/discover/${mediaType}`, {
      with_origin_country: "DK",
      with_original_language: "da",
      sort_by: `${dateField}.desc`,
      include_adult: "false",
      page: String(page),
      language: "da-DK"
    });
    if (!data.results || data.results.length === 0) break;
    items.push(...data.results);
    if (page >= (data.total_pages || 1)) break;
  }

  return items.map((item) => {
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
      genres,
      origin_countries: item.origin_country || [],
      original_language: item.original_language || null,
      raw_data: item
    };
  });
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
         genres JSONB, origin_countries JSONB, original_language TEXT,
         raw_data JSONB
       )
     ),
     upserted AS (
       INSERT INTO titles (
         tmdb_id, type, title, original_title, year, release_date, overview,
         poster_path, backdrop_path, vote_average, vote_count, genres,
         origin_countries, original_language, danish_verified, source,
         last_updated_at, raw_data
       )
       SELECT
         tmdb_id, type, title, original_title, year,
         NULLIF(release_date, '')::date, overview, poster_path, backdrop_path,
         vote_average, vote_count, genres, origin_countries, original_language,
         true, 'tmdb_discover', now(), raw_data
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
      const [movies, series] = await Promise.all([
        discoverType(apiKey, "movie", pagesPerRun),
        discoverType(apiKey, "series", pagesPerRun)
      ]);
      const all = [...movies, ...series];

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
        moviesSeen: movies.length,
        seriesSeen: series.length,
        titlesFound: all.length,
        created,
        updated
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
