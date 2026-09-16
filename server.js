const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = process.env.PORT || 7000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!TMDB_API_KEY) {
  console.error("Missing TMDB_API_KEY environment variable.");
  process.exit(1);
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

const catalogs = [
  { type: "movie", id: "danske_film", name: "🇩🇰 Danske film", params: { with_origin_country: "DK" } },
  { type: "series", id: "danske_serier", name: "🇩🇰 Danske serier", params: { with_origin_country: "DK" } },

  { type: "movie", id: "danske_klassikere", name: "🎬 Danske klassikere",
    params: { with_origin_country: "DK", "primary_release_date.lte": "1999-12-31" } },

  { type: "movie", id: "danske_komedier", name: "😂 Danske komedier",
    params: { with_origin_country: "DK", with_genres: "35" } },

  { type: "movie", id: "danske_krimier", name: "🔪 Danske krimier",
    params: { with_origin_country: "DK", with_genres: "80" } },

  { type: "movie", id: "danske_film_2020_2026", name: "📅 Danske film 2020–2026",
    params: {
      with_origin_country: "DK",
      "primary_release_date.gte": "2020-01-01",
      "primary_release_date.lte": "2026-12-31"
    } },

  { type: "movie", id: "danske_film_2000_2019", name: "📅 Danske film 2000–2019",
    params: {
      with_origin_country: "DK",
      "primary_release_date.gte": "2000-01-01",
      "primary_release_date.lte": "2019-12-31"
    } },

  { type: "movie", id: "danske_film_foer_2000", name: "📼 Danske film før 2000",
    params: { with_origin_country: "DK", "primary_release_date.lte": "1999-12-31" } }
];

const manifest = {
  id: "dk.danish.nuvio.stremio.katalog",
  version: "1.0.0",
  name: "Danish Nuvio/Stremio Katalog",
  description: "Danske film, serier, klassikere, komedier, krimier og årgange. Katalog-addon til Stremio og Nuvio.",
  logo: "https://www.stremio.com/website/stremio-logo-small.png",
  resources: ["catalog"],
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
const CACHE_MS = 10 * 60 * 1000;

function getCatalog(id) {
  return catalogs.find(c => c.id === id);
}

function tmdbParams(obj) {
  const p = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: "da-DK",
    include_adult: "false",
    include_video: "false",
    sort_by: "popularity.desc",
    ...obj
  });
  return p;
}

async function tmdb(path, params) {
  const url = `${TMDB_BASE}${path}?${tmdbParams(params).toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.json();
}

function toMeta(item, type) {
  const date = type === "movie" ? item.release_date : item.first_air_date;
  const posterPath = item.poster_path || null;
  return {
    id: `tmdb:${item.id}`,
    type,
    name: item.title || item.name,
    releaseInfo: date ? date.slice(0, 4) : undefined,
    poster: posterPath ? `${IMAGE_BASE}${posterPath}` : undefined,
    posterShape: "poster",
    description: item.overview || undefined,
    imdb_id: undefined
  };
}

builder.defineCatalogHandler(async (args) => {
  const cfg = getCatalog(args.id);
  if (!cfg) throw new Error("Unknown catalog");

  const skip = Math.max(0, Number(args.extra?.skip || 0));
  const page = Math.floor(skip / 20) + 1;

  const params = { ...cfg.params, page };

  if (args.extra?.search) {
    // Search is intentionally limited to the catalog's TMDB-filtered universe.
    // TMDB discover does not provide text search, so we use the search endpoint
    // and keep only results that belong to Denmark when practical.
    const searchPath = cfg.type === "movie" ? "/search/movie" : "/search/tv";
    const data = await tmdb(searchPath, {
      query: args.extra.search,
      page,
      region: "DK"
    });

    const results = (data.results || []).filter(item => {
      const countries = cfg.type === "movie"
        ? (item.production_countries || []).map(x => x.iso_3166_1)
        : (item.origin_country || []);
      return countries.includes("DK");
    });

    return { metas: results.slice(0, 20).map(x => toMeta(x, cfg.type)) };
  }

  const key = `${cfg.id}:${page}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_MS) {
    return { metas: cached.metas };
  }

  const path = cfg.type === "movie" ? "/discover/movie" : "/discover/tv";
  const data = await tmdb(path, params);
  const metas = (data.results || []).map(x => toMeta(x, cfg.type));

  cache.set(key, { time: Date.now(), metas });
  return { metas };
});

serveHTTP(builder.getInterface(), {
  port: PORT,
  cacheMaxAge: 600
});
