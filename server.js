const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const { runDiscovery } = require("./discover");

const PORT = Number(process.env.PORT) || 7000;
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

// Resolved at request time (not at server boot) so long-lived instances
// never serve a stale "today" once midnight passes.
function todayIso() {
  const now = new Date();
  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0")
  ].join("-");
}

// Marker resolved to the real date by resolveParams() on every request.
const TODAY = "{TODAY}";

// TMDB uses a different date field for movies vs. TV series.
function releaseDateParams(type, { gte, lte } = {}) {
  const field = type === "movie" ? "primary_release_date" : "first_air_date";
  const out = {};
  if (gte) out[`${field}.gte`] = gte;
  if (lte) out[`${field}.lte`] = lte;
  return out;
}

function resolveParams(params) {
  const resolved = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = value === TODAY ? todayIso() : value;
  }
  return resolved;
}

const catalogs = [
  {
    type: "movie",
    id: "danske_film",
    name: "🇩🇰 Danske film",
    params: {
      ...DANISH_FILTER,
      "vote_count.gte": "10",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "series",
    id: "danske_serier",
    name: "🇩🇰 Danske serier",
    params: {
      ...DANISH_FILTER,
      "vote_count.gte": "10",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "movie",
    id: "danske_nye",
    name: "🔥 Nye danske film",
    params: {
      ...DANISH_FILTER,
      ...releaseDateParams("movie", { gte: "2020-01-01", lte: TODAY }),
      "vote_count.gte": "5",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "series",
    id: "danske_serier_nye",
    name: "🔥 Nye danske serier",
    params: {
      ...DANISH_FILTER,
      ...releaseDateParams("series", { gte: "2020-01-01", lte: TODAY }),
      "vote_count.gte": "3",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "movie",
    id: "danske_populaere",
    name: "⭐ Populære danske film",
    params: {
      ...DANISH_FILTER,
      "vote_count.gte": "25",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "series",
    id: "danske_serier_populaere",
    name: "⭐ Populære danske serier",
    params: {
      ...DANISH_FILTER,
      "vote_count.gte": "15",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "movie",
    id: "danske_bedst_bedomte",
    name: "🏆 Bedst bedømte danske film",
    params: {
      ...DANISH_FILTER,
      "vote_count.gte": "100",
      sort_by: "vote_average.desc"
    }
  },
  {
    type: "series",
    id: "danske_serier_bedst_bedomte",
    name: "🏆 Bedst bedømte danske serier",
    params: {
      ...DANISH_FILTER,
      "vote_count.gte": "30",
      sort_by: "vote_average.desc"
    }
  },
  {
    type: "movie",
    id: "danske_klassikere",
    name: "🎬 Danske klassikere",
    params: {
      ...DANISH_FILTER,
      ...releaseDateParams("movie", { lte: "1999-12-31" }),
      "vote_count.gte": "20",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "series",
    id: "danske_serier_klassikere",
    name: "📼 Danske klassiske serier",
    params: {
      ...DANISH_FILTER,
      ...releaseDateParams("series", { lte: "1999-12-31" }),
      "vote_count.gte": "8",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "movie",
    id: "danske_komedier",
    name: "😂 Danske komedier",
    params: {
      ...DANISH_FILTER,
      with_genres: "35",
      "vote_count.gte": "20",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "series",
    id: "danske_serier_komedie",
    name: "😂 Danske komedieserier",
    params: {
      ...DANISH_FILTER,
      with_genres: "35",
      "vote_count.gte": "8",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "movie",
    id: "danske_krimier",
    name: "🔪 Danske krimier",
    params: {
      ...DANISH_FILTER,
      with_genres: "80",
      "vote_count.gte": "20",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "series",
    id: "danske_serier_krimi",
    name: "🔪 Danske krimiserier",
    params: {
      ...DANISH_FILTER,
      with_genres: "80",
      "vote_count.gte": "8",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "movie",
    id: "danske_dramaer",
    name: "🎭 Danske dramaer",
    params: {
      ...DANISH_FILTER,
      with_genres: "18",
      "vote_count.gte": "20",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "series",
    id: "danske_serier_drama",
    name: "🎭 Danske dramaserier",
    params: {
      ...DANISH_FILTER,
      with_genres: "18",
      "vote_count.gte": "8",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "movie",
    id: "danske_film_2020_2026",
    name: "📅 Danske film 2020–{YEAR}",
    params: {
      ...DANISH_FILTER,
      ...releaseDateParams("movie", { gte: "2020-01-01", lte: TODAY }),
      "vote_count.gte": "5",
      sort_by: "primary_release_date.desc"
    }
  },
  {
    type: "movie",
    id: "danske_film_2000_2019",
    name: "📅 Danske film 2000–2019",
    params: {
      ...DANISH_FILTER,
      ...releaseDateParams("movie", { gte: "2000-01-01", lte: "2019-12-31" }),
      "vote_count.gte": "20",
      sort_by: "popularity.desc"
    }
  },
  {
    type: "movie",
    id: "danske_film_foer_2000",
    name: "📼 Danske film før 2000",
    params: {
      ...DANISH_FILTER,
      ...releaseDateParams("movie", { lte: "1999-12-31" }),
      "vote_count.gte": "20",
      sort_by: "popularity.desc"
    }
  }
];

function resolveCatalogName(catalog) {
  return catalog.name.replace("{YEAR}", String(new Date().getUTCFullYear()));
}

const manifest = {
  id: "dk.danish.nuvio.katalog",
  version: "2.3.0",
  name: "Dansk Film – Nuvio",
  description:
    "Danske film og serier med dynamiske kataloger, søgning, metadata, kvalitetsfiltre og konfigurerbare kataloger.",
  logo: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiNjODEwMmUiLz48cmVjdCB4PSIyMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjY0IiBmaWxsPSIjZmZmIi8+PHJlY3QgeT0iMjciIHdpZHRoPSI2NCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2ZmZiIvPjwvc3ZnPgo=",
  resources: [
    { name: "catalog", types: ["movie", "series"] },
    { name: "meta", types: ["movie", "series"], idPrefixes: ["tmdb:"] }
  ],
  types: ["movie", "series"],
  catalogs: catalogs.map((catalog) => ({
    type: catalog.type,
    id: catalog.id,
    name: resolveCatalogName(catalog),
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
const MAX_CACHE_ENTRIES = 500;

function getCatalog(id) {
  return catalogs.find((catalog) => catalog.id === id);
}

function setCache(key, data) {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { time: Date.now(), data });
}

function getCached(key, maxAge) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.time >= maxAge) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function tmdbParams(params = {}) {
  return new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: "da-DK",
    include_adult: "false",
    include_video: "false",
    ...params
  });
}

async function tmdb(path, params = {}) {
  const url = `${TMDB_BASE}${path}?${tmdbParams(params).toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`TMDB HTTP ${response.status}`);
  }

  return response.json();
}

function clean(value) {
  return value === null || value === undefined || value === ""
    ? undefined
    : value;
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
      : posterPath
        ? `${IMAGE_BASE}${posterPath}`
        : undefined,
    description: clean(item.overview),
    imdb_id: clean(item.external_ids?.imdb_id),
    genres: Array.isArray(item.genres)
      ? item.genres.map((genre) => genre.name).filter(Boolean)
      : undefined,
    imdbRating:
      typeof item.vote_average === "number" && item.vote_count > 0
        ? item.vote_average
        : undefined
  };

  if (detailed) {
    meta.runtime =
      type === "movie"
        ? item.runtime
          ? item.runtime * 60
          : undefined
        : item.episode_run_time?.[0]
          ? item.episode_run_time[0] * 60
          : undefined;

    meta.director =
      type === "movie"
        ? item.credits?.crew?.find((person) => person.job === "Director")?.name
        : undefined;

    meta.cast = item.credits?.cast
      ?.slice(0, 10)
      .map((person) => person.name)
      .filter(Boolean);

    meta.trailers = item.videos?.results
      ?.filter(
        (video) => video.site === "YouTube" && video.type === "Trailer"
      )
      .slice(0, 3)
      .map((video) => ({
        source: video.key,
        type: "Trailer"
      }));
  }

  return meta;
}

function isDanish(item, type) {
  const originalLanguage = item.original_language;

  if (originalLanguage !== "da") {
    return false;
  }

  if (type === "movie") {
    const countries = (item.production_countries || []).map(
      (country) => country.iso_3166_1
    );

    return countries.length === 0 || countries.includes("DK");
  }

  const countries = item.origin_country || [];
  return countries.length === 0 || countries.includes("DK");
}

async function getDetailedMeta(id, type) {
  const key = `detail:${type}:${id}`;
  const cached = getCached(key, DETAIL_CACHE_MS);

  if (cached) {
    return cached;
  }

  const path = type === "movie" ? `/movie/${id}` : `/tv/${id}`;
  const data = await tmdb(path, {
    append_to_response: "credits,videos,external_ids"
  });

  const meta = toMeta(data, type, true);
  setCache(key, meta);
  return meta;
}

builder.defineCatalogHandler(async (args) => {
  const catalog = getCatalog(args.id);

  if (!catalog) {
    throw new Error("Unknown catalog");
  }

  const skip = Math.max(0, Number(args.extra?.skip || 0));
  const page = Math.floor(skip / 20) + 1;

  if (args.extra?.search) {
    const searchPath =
      catalog.type === "movie" ? "/search/movie" : "/search/tv";

    const data = await tmdb(searchPath, {
      query: String(args.extra.search).trim(),
      page,
      region: "DK"
    });

    return {
      metas: (data.results || [])
        .filter((item) => isDanish(item, catalog.type))
        .filter((item) => item.poster_path)
        .slice(0, 20)
        .map((item) => toMeta(item, catalog.type))
    };
  }

  const key = `${catalog.id}:${page}`;
  const cached = getCached(key, CACHE_MS);

  if (cached) {
    return {
      metas: cached,
      cacheMaxAge: 900,
      staleRevalidate: 3600,
      staleIfError: 86400
    };
  }

  const path =
    catalog.type === "movie" ? "/discover/movie" : "/discover/tv";

  const data = await tmdb(path, {
    ...resolveParams(catalog.params),
    page
  });

  const metas = (data.results || [])
    .filter((item) => item.original_language === "da")
    .filter((item) => item.poster_path)
    .map((item) => toMeta(item, catalog.type));

  setCache(key, metas);

  return {
    metas,
    cacheMaxAge: 900,
    staleRevalidate: 3600,
    staleIfError: 86400
  };
});

builder.defineMetaHandler(async (args) => {
  const match = String(args.id || "").match(/^tmdb:(\d+)$/);

  if (!match) {
    return { meta: null };
  }

  const id = match[1];
  const type = args.type === "series" ? "series" : "movie";

  try {
    return {
      meta: await getDetailedMeta(id, type)
    };
  } catch (error) {
    console.error("Metadata error:", error.message);
    return { meta: null };
  }
});

const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);
const app = express();

// Render (and most hosts) terminate TLS at a reverse proxy and forward the
// original scheme via X-Forwarded-Proto. Without trusting the proxy, Express
// reports req.protocol as "http" even when the real request was https,
// which made the installer show "http://" links on the live deployment.
app.set("trust proxy", true);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

const BASE_URL = process.env.PUBLIC_BASE_URL || "";

function publicBase(req) {
  return (BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function selectedCatalogs(value) {
  if (!value) {
    return catalogs;
  }

  const ids = String(value)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const allowed = new Set(catalogs.map((catalog) => catalog.id));
  const unique = [...new Set(ids)].filter((id) => allowed.has(id));

  return unique.length
    ? catalogs.filter((catalog) => unique.includes(catalog.id))
    : catalogs;
}

function manifestFor(catalogList) {
  return {
    ...manifest,
    catalogs: catalogList.map((catalog) => ({
      type: catalog.type,
      id: catalog.id,
      name: resolveCatalogName(catalog),
      extra: [
        { name: "skip", isRequired: false },
        { name: "search", isRequired: false }
      ]
    }))
  };
}

function encodeConfig(ids) {
  return Buffer.from(ids.join(","), "utf8").toString("base64url");
}

function decodeConfig(value) {
  try {
    return Buffer.from(String(value), "base64url").toString("utf8");
  } catch {
    return "";
  }
}

const landingPage = (req) => {
  const base = publicBase(req);
  const standardUrl = `${base}/manifest.json`;
  const catalogJson = JSON.stringify(
    catalogs.map((catalog) => ({
      id: catalog.id,
      type: catalog.type,
      name: resolveCatalogName(catalog)
    }))
  ).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0f17">
<meta name="description" content="Danish movies and TV series catalog addon for Nuvio.">
<title>Danish Film – Nuvio</title>
<style>
:root{
  color-scheme:dark;
  --bg:#0b0f17;
  --card:#141a24;
  --border:#293445;
  --text:#f5f7fb;
  --muted:#9ca8ba;
  --accent:#e21d35;
  --accent2:#ff334b;
}
*{box-sizing:border-box}
html{background:var(--bg)}
body{
  margin:0;
  background:
    radial-gradient(circle at 50% -10%,rgba(226,29,53,.13),transparent 38%),
    linear-gradient(180deg,#0b0f17 0%,#0e131c 100%);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;
  color:var(--text);
  -webkit-font-smoothing:antialiased;
}
main{max-width:760px;margin:auto;padding:34px 18px 72px}
.hero{text-align:center;padding:18px 0 24px}
.logo{
  width:72px;height:72px;margin:0 auto 14px;
  display:grid;place-items:center;
  border:1px solid rgba(255,255,255,.12);
  border-radius:22px;
  background:linear-gradient(145deg,#192131,#101620);
  box-shadow:0 18px 45px rgba(0,0,0,.28);
  font-size:38px;
}
.hero h1{font-size:31px;line-height:1.1;margin:0 0 9px;letter-spacing:-.6px}
.hero p{color:var(--muted);font-size:16px;margin:0}
.card{
  background:rgba(20,26,36,.92);
  border:1px solid var(--border);
  border-radius:20px;
  padding:22px;
  margin-top:16px;
  box-shadow:0 12px 35px rgba(0,0,0,.18);
}
h2{font-size:20px;line-height:1.2;margin:0 0 7px}
.sub{color:var(--muted);margin:0 0 18px;line-height:1.45}
.primary{
  display:block;width:100%;
  border:0;border-radius:13px;
  padding:15px 18px;
  background:linear-gradient(180deg,var(--accent2),var(--accent));
  color:white;font-weight:750;font-size:16px;
  cursor:pointer;box-shadow:0 8px 20px rgba(226,29,53,.18);
}
.secondary{
  border:1px solid var(--border);
  background:#1a2230;color:var(--text);
  border-radius:12px;padding:11px 14px;
  font-weight:650;cursor:pointer;
}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}
.item{
  display:flex;gap:10px;align-items:center;
  border:1px solid var(--border);border-radius:12px;
  padding:11px;background:#111722;
  min-height:47px;
}
.item input{width:19px;height:19px;accent-color:var(--accent);flex:0 0 auto}
.item span{font-size:14px;line-height:1.25}
.url-wrap{margin-top:14px}
.url-label{
  display:flex;align-items:center;justify-content:space-between;
  color:#aeb8c8;font-size:12px;font-weight:700;
  text-transform:uppercase;letter-spacing:.7px;margin:0 2px 7px;
}
.url{
  display:flex;align-items:center;gap:10px;
  width:100%;min-height:54px;
  padding:9px 12px;
  background:linear-gradient(180deg,#222b3a,#1a2230);
  border:1px solid #364357;
  border-radius:16px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 7px 20px rgba(0,0,0,.16);
}
.url-icon{
  width:32px;height:32px;flex:0 0 32px;
  display:grid;place-items:center;
  border-radius:10px;background:#101722;
  color:#c9d2df;font-size:15px;
}
.url-text{
  min-width:0;
  color:#f2f5f9;
  font-size:13px;
  line-height:1.35;
  overflow-wrap:anywhere;
  user-select:text;
  -webkit-user-select:text;
}
.copy-mini{
  margin-left:auto;flex:0 0 auto;
  border:1px solid #3b485c;
  background:#101722;color:#e8edf4;
  border-radius:10px;padding:8px 10px;
  font-size:12px;font-weight:700;cursor:pointer;
}
.copy-mini:active,.secondary:active,.primary:active{transform:scale(.985)}
.note{font-size:13px;color:var(--muted);line-height:1.55;margin-top:14px}
.status{min-height:18px;color:#8fe0a7;font-size:13px;font-weight:650;margin:9px 2px 0}
.footer{text-align:center;color:#6f7a8b;font-size:12px;margin-top:22px}
@media(max-width:560px){
  main{padding:24px 14px 60px}
  .grid{grid-template-columns:1fr}
  .hero h1{font-size:28px}
  .card{padding:18px}
  .url{border-radius:17px}
  .url-text{font-size:12.5px}
}
</style>
</head>
<body><main>
<section class="hero">
  <div class="logo">🇩🇰</div>
  <h1>Danish Film – Nuvio</h1>
  <p>Danish movies and TV series in one place.</p>
</section>

<section class="card">
  <h2>🚀 Quick install</h2>
  <p class="sub">Install the complete addon with all available catalogs.</p>
  <button class="primary" id="copyStandard">Copy installation link</button>

  <div class="url-wrap">
    <div class="url-label"><span>Installation link</span><span>Manifest</span></div>
    <div class="url">
      <div class="url-icon">↗</div>
      <div class="url-text" id="standardUrl"></div>
      <button class="copy-mini" id="copyStandardMini">Copy</button>
    </div>
    <div class="status" id="standardStatus"></div>
  </div>

  <p class="note">Copy the manifest URL and paste it into Nuvio when installing the addon.</p>
</section>

<section class="card">
  <h2>⚙️ Customize catalogs</h2>
  <p class="sub">Choose exactly which catalogs you want to install.</p>

  <div class="actions">
    <button class="secondary" id="all">Select all</button>
    <button class="secondary" id="none">Clear all</button>
  </div>

  <div class="grid" id="catalogs"></div>

  <div class="url-wrap">
    <div class="url-label"><span>Your installation link</span><span>Dynamic</span></div>
    <div class="url">
      <div class="url-icon">↗</div>
      <div class="url-text" id="customUrl"></div>
      <button class="copy-mini" id="copyCustomMini">Copy</button>
    </div>
    <div class="status" id="customStatus"></div>
  </div>

  <div class="actions">
    <button class="primary" id="copyCustom" style="flex:1">Copy my installation link</button>
  </div>
</section>

<section class="card">
  <h2>How to install</h2>
  <p class="note">
    <b>1.</b> Use the standard link or customize your catalogs.<br>
    <b>2.</b> Press <b>Copy installation link</b>.<br>
    <b>3.</b> Open Nuvio and go to addon installation.<br>
    <b>4.</b> Paste the manifest URL and install the addon.
  </p>
</section>

<section class="card">
  <h2>About this addon</h2>
  <p class="note">
    Danish Film – Nuvio is a catalog and metadata addon focused on Danish movies
    and TV series. It does not provide video streams. Metadata is currently
    powered by TMDB.
  </p>
</section>

<div class="footer">Danish Film – Nuvio · Catalog &amp; metadata addon</div>
</main>

<script>
const catalogs=${catalogJson};
const base=${JSON.stringify(base)};
const standard=${JSON.stringify(standardUrl)};
const list=document.getElementById("catalogs");
const custom=document.getElementById("customUrl");
const standardBox=document.getElementById("standardUrl");
const boxes=[];

function render(){
  list.innerHTML="";
  boxes.length=0;

  catalogs.forEach(c=>{
    const label=document.createElement("label");
    label.className="item";

    const input=document.createElement("input");
    input.type="checkbox";
    input.checked=true;
    input.dataset.id=c.id;
    input.addEventListener("change",update);

    const span=document.createElement("span");
    span.textContent=c.name;

    label.append(input,span);
    list.append(label);
    boxes.push(input);
  });

  standardBox.textContent=standard;
  update();
}

function urlFor(){
  const ids=boxes.filter(x=>x.checked).map(x=>x.dataset.id);

  if(!ids.length){
    return base+"/manifest.json";
  }

  const encoded=btoa(unescape(encodeURIComponent(ids.join(","))))
    .replace(/=+$/,"")
    .replace(/\\+/g,"-")
    .replace(/\\//g,"_");

  return base+"/c/"+encoded+"/manifest.json";
}

function update(){
  custom.textContent=urlFor();
}

async function copyText(url,button,status){
  const old=button.textContent;

  try{
    await navigator.clipboard.writeText(url);
    button.textContent="Copied ✓";
    status.textContent="✓ Link copied to clipboard";

    setTimeout(()=>{
      button.textContent=old;
      status.textContent="";
    },1600);
  }catch{
    prompt("Copy this link:",url);
  }
}

document.getElementById("copyStandard").addEventListener("click",()=>{
  copyText(
    standard,
    document.getElementById("copyStandard"),
    document.getElementById("standardStatus")
  );
});

document.getElementById("copyStandardMini").addEventListener("click",()=>{
  copyText(
    standard,
    document.getElementById("copyStandardMini"),
    document.getElementById("standardStatus")
  );
});

document.getElementById("copyCustom").addEventListener("click",()=>{
  copyText(
    urlFor(),
    document.getElementById("copyCustom"),
    document.getElementById("customStatus")
  );
});

document.getElementById("copyCustomMini").addEventListener("click",()=>{
  copyText(
    urlFor(),
    document.getElementById("copyCustomMini"),
    document.getElementById("customStatus")
  );
});

document.getElementById("all").addEventListener("click",()=>{
  boxes.forEach(x=>x.checked=true);
  update();
});

document.getElementById("none").addEventListener("click",()=>{
  boxes.forEach(x=>x.checked=false);
  update();
});

render();
</script>
</body>
</html>`;
};

app.get("/", (req, res) => {
  res.type("html").send(landingPage(req));
});

app.get("/manifest.json", (req, res) => {
  res.json(manifestFor(catalogs));
});

app.get("/c/:config/manifest.json", (req, res) => {
  const ids = decodeConfig(req.params.config);
  res.json(manifestFor(selectedCatalogs(ids)));
});

// Triggers a discovery pass that pulls fresh pages from TMDB and upserts
// them into the persistent Postgres database (see discover.js). Safe to
// expose without a secret: runDiscovery() no-ops (returns the previous
// run's summary) if it was already run within the last hour, so this can't
// be abused for anything worse than a few extra harmless TMDB calls. It's
// meant to be hit once a day by a free scheduled trigger (this project has
// no paid Render Cron Job, so a GitHub Actions workflow calls this instead).
app.post("/internal/discover", async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(501).json({ error: "DATABASE_URL not configured" });
  }

  try {
    const summary = await runDiscovery({
      apiKey: TMDB_API_KEY,
      databaseUrl: process.env.DATABASE_URL
    });
    res.json(summary);
  } catch (error) {
    console.error("Discovery endpoint error:", error);
    res.status(500).json({ error: "Discovery failed", message: error.message });
  }
});

app.use(router);

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Danish Film – Nuvio running on port ${PORT}`);
});
