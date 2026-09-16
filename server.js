const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = process.env.PORT || 7000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!TMDB_API_KEY) {
  console.error("Missing TMDB_API_KEY environment variable.");
  process.exit(1);
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

const DANISH_FILTER = {
  with_origin_country: "DK",
  with_original_language: "da"
};

const catalogs = [
  { type: "movie", id: "danske_film", name: "🇩🇰 Danske film", params: { ...DANISH_FILTER, sort_by: "popularity.desc" } },
  { type: "series", id: "danske_serier", name: "🇩🇰 Danske serier", params: { ...DANISH_FILTER, sort_by: "popularity.desc" } },
  { type: "movie", id: "danske_nye", name: "🔥 Nye danske film", params: { ...DANISH_FILTER, "primary_release_date.gte": "2020-01-01", sort_by: "primary_release_date.desc" } },
  { type: "movie", id: "danske_populaere", name: "⭐ Populære danske film", params: { ...DANISH_FILTER, sort_by: "popularity.desc" } },
  { type: "movie", id: "danske_bedst_bedomte", name: "🏆 Bedst bedømte danske film", params: { ...DANISH_FILTER, "vote_count.gte": "50", sort_by: "vote_average.desc" } },
  { type: "movie", id: "danske_klassikere", name: "🎬 Danske klassikere", params: { ...DANISH_FILTER, "primary_release_date.lte": "1999-12-31", sort_by: "vote_average.desc" } },
  { type: "movie", id: "danske_komedier", name: "😂 Danske komedier", params: { ...DANISH_FILTER, with_genres: "35", sort_by: "popularity.desc" } },
  { type: "movie", id: "danske_krimier", name: "🔪 Danske krimier", params: { ...DANISH_FILTER, with_genres: "80", sort_by: "popularity.desc" } },
  { type: "movie", id: "danske_dramaer", name: "🎭 Danske dramaer", params: { ...DANISH_FILTER, with_genres: "18", sort_by: "popularity.desc" } },
  { type: "movie", id: "danske_film_2020_2026", name: "📅 Danske film 2020–2026", params: { ...DANISH_FILTER, "primary_release_date.gte": "2020-01-01", "primary_release_date.lte": "2026-12-31", sort_by: "primary_release_date.desc" } },
  { type: "movie", id: "danske_film_2000_2019", name: "📅 Danske film 2000–2019", params: { ...DANISH_FILTER, "primary_release_date.gte": "2000-01-01", "primary_release_date.lte": "2019-12-31", sort_by: "primary_release_date.desc" } },
  { type: "movie", id: "danske_film_foer_2000", name: "📼 Danske film før 2000", params: { ...DANISH_FILTER, "primary_release_date.lte": "1999-12-31", sort_by: "primary_release_date.desc" } }
];

const manifest = {
  id: "dk.danish.nuvio.stremio.katalog",
  version: "2.0.1",
  name: "Dansk Film – Nuvio",
  description: "Danske film og serier med dynamiske kataloger, søgning, forbedret billedhåndtering, metadata og automatisk opdaterede TMDB-resultater.",
  logo: "https://www.stremio.com/website/stremio-logo-small.png",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  catalogs: catalogs.map(c => ({
    type: c.type,
    id: c.id,
    name: c.name,
    extra: [
      { name: "skip", isRequired: false },
      { name: "search", isRequired: false }
    ]
  }))
};

const builder = new addonBuilder(manifest);

const cache = new Map();
const CACHE_MS = 15 * 60 * 1000;
const DETAIL_CACHE_MS = 60 * 60 * 1000;

function getCatalog(id) {
  return catalogs.find(c => c.id === id);
}

function tmdbParams(obj) {
  return new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: "da-DK",
    include_adult: "false",
    include_video: "false",
    ...obj
  });
}

async function tmdb(path, params) {
  const url = `${TMDB_BASE}${path}?${tmdbParams(params).toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.json();
}

function clean(value) {
  return value === null || value === undefined || value === "" ? undefined : value;
}

function toMeta(item, type, detailed = false) {
  const date = type === "movie" ? item.release_date : item.first_air_date;
  const posterPath = item.poster_path;
  const backdropPath = item.backdrop_path;

  const meta = {
    id: `tmdb:${item.id}`,
    type,
    name: clean(item.title || item.name),
    releaseInfo: date ? date.slice(0, 4) : undefined,
    poster: posterPath ? `${IMAGE_BASE}${posterPath}` : undefined,
    posterShape: "poster",
    background: backdropPath
      ? `${BACKDROP_BASE}${backdropPath}`
      : (posterPath ? `${IMAGE_BASE}${posterPath}` : undefined),
    description: clean(item.overview),
    imdb_id: clean(item.external_ids?.imdb_id),
    genres: Array.isArray(item.genres)
      ? item.genres.map(g => g.name)
      : undefined,
    imdbRating: typeof item.vote_average === "number" && item.vote_count > 0
      ? item.vote_average
      : undefined
  };

  if (detailed) {
    meta.runtime = type === "movie"
      ? (item.runtime ? item.runtime * 60 : undefined)
      : (item.episode_run_time?.[0] ? item.episode_run_time[0] * 60 : undefined);

    meta.director = type === "movie"
      ? item.credits?.crew?.find(x => x.job === "Director")?.name
      : undefined;

    meta.cast = item.credits?.cast
      ?.slice(0, 10)
      .map(x => x.name)
      .filter(Boolean);

    meta.trailers = item.videos?.results
      ?.filter(v => v.site === "YouTube" && v.type === "Trailer")
      .slice(0, 3)
      .map(v => ({ source: v.key, type: "Trailer" }));
  }

  return meta;
}

async function getDetailedMeta(id, type) {
  const key = `detail:${type}:${id}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < DETAIL_CACHE_MS) return cached.data;

  const path = type === "movie" ? `/movie/${id}` : `/tv/${id}`;
  const data = await tmdb(path, {
    append_to_response: "credits,videos,external_ids"
  });

  const meta = toMeta(data, type, true);
  cache.set(key, { time: Date.now(), data: meta });
  return meta;
}

function isDanish(item, type) {
  const originalLanguage = item.original_language;
  const countries = type === "movie"
    ? (item.production_countries || []).map(x => x.iso_3166_1)
    : (item.origin_country || []);

  return originalLanguage === "da" && countries.includes("DK");
}

builder.defineCatalogHandler(async args => {
  const cfg = getCatalog(args.id);
  if (!cfg) throw new Error("Unknown catalog");

  const skip = Math.max(0, Number(args.extra?.skip || 0));
  const page = Math.floor(skip / 20) + 1;

  if (args.extra?.search) {
    const searchPath = cfg.type === "movie" ? "/search/movie" : "/search/tv";
    const data = await tmdb(searchPath, {
      query: args.extra.search,
      page,
      region: "DK"
    });

    return {
      metas: (data.results || [])
        .filter(item => isDanish(item, cfg.type))
        .slice(0, 20)
        .map(item => toMeta(item, cfg.type))
    };
  }

  const key = `${cfg.id}:${page}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_MS) {
    return { metas: cached.metas, cacheMaxAge: 900, staleRevalidate: 3600, staleIfError: 86400 };
  }

  const path = cfg.type === "movie" ? "/discover/movie" : "/discover/tv";
  const data = await tmdb(path, { ...cfg.params, page });

  const metas = (data.results || [])
    .filter(item => item.original_language === "da")
    .filter(item => item.poster_path)
    .map(item => toMeta(item, cfg.type));

  cache.set(key, { time: Date.now(), metas });

  return {
    metas,
    cacheMaxAge: 900,
    staleRevalidate: 3600,
    staleIfError: 86400
  };
});

builder.defineMetaHandler(async args => {
  const match = String(args.id || "").match(/^tmdb:(\d+)$/);
  if (!match) return { meta: null };

  const id = match[1];
  const type = args.type === "series" ? "series" : "movie";

  try {
    return { meta: await getDetailedMeta(id, type) };
  } catch (err) {
    console.error("Metadata error:", err.message);
    return { meta: null };
  }
});

serveHTTP(builder.getInterface(), {
  port: PORT,
  cacheMaxAge: 900,
  staleRevalidate: 3600,
  staleIfError: 86400
});
