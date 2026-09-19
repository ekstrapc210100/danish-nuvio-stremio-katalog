// discover.js — Automatic discovery of Danish movies & series.
//
// Runs as a standalone Render Cron Job (not part of the main web server).
// Pulls fresh pages from TMDB's discover endpoints and upserts them into
// the Neon Postgres database, building a persistent catalog over time
// instead of relying purely on live per-request TMDB calls.
//
// Env vars required: TMDB_API_KEY, DATABASE_URL

const { Client } = require("pg");

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const TMDB_BASE = "https://api.themoviedb.org/3";

// How many discover pages to pull per type, per run. TMDB returns 20
// results/page. Running daily, this keeps well within TMDB's rate limits
// while gradually building full historical coverage and always re-checking
// the newest releases (which change most often).
const PAGES_PER_RUN = 15;

if (!TMDB_API_KEY) {
  console.error("Missing TMDB_API_KEY");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

async function tmdbFetch(path, params = {}) {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", TMDB_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function loadGenreMap(mediaType) {
  const data = await tmdbFetch(`/genre/${mediaType}/list`, { language: "da-DK" });
  const map = new Map();
  for (const g of data.genres || []) map.set(g.id, g.name);
  return map;
}

async function discoverType(type) {
  const mediaType = type === "movie" ? "movie" : "tv";
  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
  const genreMap = await loadGenreMap(mediaType);

  const items = [];
  for (let page = 1; page <= PAGES_PER_RUN; page++) {
    const data = await tmdbFetch(`/discover/${mediaType}`, {
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
      original_title: originalTitle,
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

async function upsertTitles(client, titles) {
  let created = 0;
  let updated = 0;
  for (const t of titles) {
    const result = await client.query(
      `INSERT INTO titles (
         tmdb_id, type, title, original_title, year, release_date, overview,
         poster_path, backdrop_path, vote_average, vote_count, genres,
         origin_countries, original_language, danish_verified, source,
         last_updated_at, raw_data
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,'tmdb_discover',now(),$15
       )
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
       RETURNING (xmax = 0) AS inserted`,
      [
        t.tmdb_id, t.type, t.title, t.original_title, t.year, t.release_date,
        t.overview, t.poster_path, t.backdrop_path, t.vote_average, t.vote_count,
        t.genres, t.origin_countries, t.original_language, JSON.stringify(t.raw_data)
      ]
    );
    if (result.rows[0]?.inserted) created++;
    else updated++;
  }
  return { created, updated };
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const runResult = await client.query(
    `INSERT INTO discovery_runs (status) VALUES ('running') RETURNING id`
  );
  const runId = runResult.rows[0].id;

  try {
    const [movies, series] = await Promise.all([
      discoverType("movie"),
      discoverType("series")
    ]);
    const all = [...movies, ...series];

    const { created, updated } = await upsertTitles(client, all);

    await client.query(
      `UPDATE discovery_runs
       SET finished_at = now(), titles_found = $2, titles_new = $3,
           titles_updated = $4, status = 'success'
       WHERE id = $1`,
      [runId, all.length, created, updated]
    );

    console.log(
      `Discovery run ${runId} done: ${all.length} titles seen (${movies.length} movies, ${series.length} series), ${created} new, ${updated} updated.`
    );
  } catch (err) {
    await client.query(
      `UPDATE discovery_runs SET finished_at = now(), status = 'error', error = $2 WHERE id = $1`,
      [runId, String(err.message || err)]
    );
    console.error("Discovery run failed:", err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
