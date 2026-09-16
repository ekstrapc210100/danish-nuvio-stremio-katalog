const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");

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
  // Hovedkatalog: bredt, men undgår helt ukendte TMDB-poster med næsten ingen stemmer.
  { type: "movie", id: "danske_film", name: "🇩🇰 Danske film", params: { ...DANISH_FILTER, "vote_count.gte": "10", sort_by: "popularity.desc" } },
  { type: "series", id: "danske_serier", name: "🇩🇰 Danske serier", params: { ...DANISH_FILTER, "vote_count.gte": "10", sort_by: "popularity.desc" } },

  // Nye film: ingen fremtidige 2027+ titler i en kategori, der hedder 2020–nu.
  { type: "movie", id: "danske_nye", name: "🔥 Nye danske film", params: { ...DANISH_FILTER, "primary_release_date.gte": "2020-01-01", "primary_release_date.lte": "2026-09-16", "vote_count.gte": "5", sort_by: "popularity.desc" } },

  { type: "movie", id: "danske_populaere", name: "⭐ Populære danske film", params: { ...DANISH_FILTER, "vote_count.gte": "25", sort_by: "popularity.desc" } },
  { type: "movie", id: "danske_bedst_bedomte", name: "🏆 Bedst bedømte danske film", params: { ...DANISH_FILTER, "vote_count.gte": "100", sort_by: "vote_average.desc" } },

  // Klassikere: stadig åbne nok til at finde ældre danske film, men med et minimum af TMDB-data.
  { type: "movie", id: "danske_klassikere", name: "🎬 Danske klassikere", params: { ...DANISH_FILTER, "primary_release_date.lte": "1999-12-31", "vote_count.gte": "20", sort_by: "popularity.desc" } },

  { type: "movie", id: "danske_komedier", name: "😂 Danske komedier", params: { ...DANISH_FILTER, with_genres: "35", "vote_count.gte": "20", sort_by: "popularity.desc" } },
  { type: "movie", id: "danske_krimier", name: "🔪 Danske krimier", params: { ...DANISH_FILTER, with_genres: "80", "vote_count.gte": "20", sort_by: "popularity.desc" } },
  { type: "movie", id: "danske_dramaer", name: "🎭 Danske dramaer", params: { ...DANISH_FILTER, with_genres: "18", "vote_count.gte": "20", sort_by: "popularity.desc" } },

  { type: "movie", id: "danske_film_2020_2026", name: "📅 Danske film 2020–2026", params: { ...DANISH_FILTER, "primary_release_date.gte": "2020-01-01", "primary_release_date.lte": "2026-09-16", "vote_count.gte": "5", sort_by: "primary_release_date.desc" } },
  { type: "movie", id: "danske_film_2000_2019", name: "📅 Danske film 2000–2019", params: { ...DANISH_FILTER, "primary_release_date.gte": "2000-01-01", "primary_release_date.lte": "2019-12-31", "vote_count.gte": "20", sort_by: "popularity.desc" } },
  { type: "movie", id: "danske_film_foer_2000", name: "📼 Danske film før 2000", params: { ...DANISH_FILTER, "primary_release_date.lte": "1999-12-31", "vote_count.gte": "20", sort_by: "popularity.desc" } }
];

const manifest = {
  id: "dk.danish.nuvio.stremio.katalog",
  version: "2.2.0",
  name: "Dansk Film – Nuvio",
  description: "Danske film og serier med dynamiske kataloger, søgning, forbedret billedhåndtering, kvalitetsfiltre, metadata, konfigurerbare kataloger og automatisk opdaterede TMDB-resultater.",
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

const addonInterface = builder.getInterface();
const router = getRouter(addonInterface);
const app = express();

app.disable("x-powered-by");
app.use(express.json());

const BASE_URL = process.env.PUBLIC_BASE_URL || "";
const DEFAULT_CATALOG_IDS = catalogs.map(c => c.id);

function publicBase(req) {
  return (BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function selectedCatalogs(value) {
  if (!value) return catalogs;
  const ids = String(value).split(",").filter(Boolean);
  const allowed = new Set(catalogs.map(c => c.id));
  const unique = [...new Set(ids)].filter(id => allowed.has(id));
  return unique.length ? catalogs.filter(c => unique.includes(c.id)) : catalogs;
}

function manifestFor(req, catalogList) {
  return {
    ...manifest,
    version: "2.2.0",
    catalogs: catalogList.map(c => ({
      type: c.type,
      id: c.id,
      name: c.name,
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
  const catalogJson = JSON.stringify(catalogs.map(c => ({
    id: c.id, type: c.type, name: c.name
  }))).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dansk Film – Nuvio</title>
<style>
:root{color-scheme:dark;--bg:#0b0d10;--card:#14181d;--border:#293039;--text:#f4f5f6;--muted:#aab2bb;--accent:#e11d2e}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#0b0d10,#101318);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text)}
main{max-width:760px;margin:auto;padding:42px 20px 70px}.hero{text-align:center;padding:28px 0 30px}
.logo{font-size:48px;margin-bottom:8px}.hero h1{font-size:34px;margin:0 0 8px}.hero p{color:var(--muted);font-size:17px;margin:0}
.card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:22px;margin-top:18px}
h2{font-size:20px;margin:0 0 6px}.sub{color:var(--muted);margin:0 0 18px}
.primary{display:block;width:100%;border:0;border-radius:12px;padding:15px 18px;background:var(--accent);color:white;font-weight:700;font-size:17px;cursor:pointer}
.secondary{border:1px solid var(--border);background:#1a1f25;color:var(--text);border-radius:10px;padding:12px 14px;font-weight:600;cursor:pointer}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.item{display:flex;gap:10px;align-items:center;border:1px solid var(--border);border-radius:11px;padding:11px;background:#11151a}
.item input{width:18px;height:18px;accent-color:var(--accent)}.item span{font-size:14px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.url{font-size:12px;color:var(--muted);word-break:break-all;margin-top:13px;padding:10px;background:#0d1014;border-radius:9px}
.note{font-size:13px;color:var(--muted);line-height:1.5;margin-top:16px}
@media(max-width:560px){.grid{grid-template-columns:1fr}.hero h1{font-size:28px}}
</style>
</head>
<body><main>
<section class="hero"><div class="logo">🇩🇰</div><h1>Dansk Film – Nuvio</h1><p>Danske film og serier samlet ét sted.</p></section>

<section class="card">
<h2>🚀 Hurtig installation</h2>
<p class="sub">Vil du bare i gang? Brug vores anbefalede komplette pakke.</p>
<button class="primary" id="copyStandard">Kopiér standardlink</button>
<div class="url" id="standardUrl"></div>
<p class="note">Kopiér linket og indsæt det i Nuvio under installation af addon.</p>
</section>

<section class="card">
<h2>⚙️ Tilpas selv</h2>
<p class="sub">Vælg præcis de kataloger, du vil have i Nuvio.</p>
<div class="actions"><button class="secondary" id="all">Vælg alle</button><button class="secondary" id="none">Fravælg alle</button></div>
<div class="grid" id="catalogs"></div>
<div class="actions"><button class="primary" id="copyCustom" style="flex:1">Kopiér mit link</button></div>
<div class="url" id="customUrl"></div>
</section>

<section class="card">
<h2>Sådan installerer du</h2>
<p class="note">1. Tryk på <b>Kopiér</b> ovenfor.<br>2. Åbn Nuvio.<br>3. Gå til addons og vælg installation via manifest/link.<br>4. Indsæt linket.</p>
</section>
</main>
<script>
const catalogs=${catalogJson};
const base=${JSON.stringify(base)};
const standard=${JSON.stringify(standardUrl)};
const list=document.getElementById("catalogs");
const custom=document.getElementById("customUrl");
const boxes=[];
function render(){
  list.innerHTML="";
  catalogs.forEach(c=>{
    const label=document.createElement("label");label.className="item";
    const input=document.createElement("input");input.type="checkbox";input.checked=true;input.dataset.id=c.id;
    input.addEventListener("change",update);
    const span=document.createElement("span");span.textContent=c.name;
    label.append(input,span);list.append(label);boxes.push(input);
  });
  update();
}
function urlFor(){
  const ids=boxes.filter(x=>x.checked).map(x=>x.dataset.id);
  const encoded=btoa(unescape(encodeURIComponent(ids.join(",")))).replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
  return base+"/c/"+encoded+"/manifest.json";
}
function update(){custom.textContent=urlFor()}
async function copy(url,button){
  try{await navigator.clipboard.writeText(url);button.textContent="Kopieret ✓";setTimeout(()=>button.textContent=button.id==="copyStandard"?"Kopiér standardlink":"Kopiér mit link",1400)}
  catch{prompt("Kopiér dette link:",url)}
}
document.getElementById("copyStandard").addEventListener("click",()=>copy(standard,document.getElementById("copyStandard")));
document.getElementById("copyCustom").addEventListener("click",()=>copy(urlFor(),document.getElementById("copyCustom")));
document.getElementById("all").addEventListener("click",()=>{boxes.forEach(x=>x.checked=true);update()});
document.getElementById("none").addEventListener("click",()=>{boxes.forEach(x=>x.checked=false);update()});
render();
</script></body></html>`;
};

app.get("/", (req,res) => res.type("html").send(landingPage(req)));

app.get("/manifest.json", (req,res) => {
  res.json(manifestFor(req, catalogs));
});

app.get("/c/:config/manifest.json", (req,res) => {
  const ids = decodeConfig(req.params.config);
  res.json(manifestFor(req, selectedCatalogs(ids)));
});

app.use(router);

app.listen(PORT, () => {
  console.log(`Dansk Film – Nuvio running on port ${PORT}`);
});
