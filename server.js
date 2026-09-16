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
  version: "2.2.1",
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
    version: "2.2.1",
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
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0f17">
<title>Dansk Film – Nuvio</title>
<style>
:root{
  color-scheme:dark;
  --bg:#0b0f17;
  --card:#141a24;
  --card2:#101620;
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
  <h1>Dansk Film – Nuvio</h1>
  <p>Danske film og serier samlet ét sted.</p>
</section>

<section class="card">
  <h2>🚀 Hurtig installation</h2>
  <p class="sub">Brug den komplette pakke med alle kataloger.</p>
  <button class="primary" id="copyStandard">Kopiér installationslink</button>

  <div class="url-wrap">
    <div class="url-label"><span>Installationslink</span><span>Manifest</span></div>
    <div class="url">
      <div class="url-icon">↗</div>
      <div class="url-text" id="standardUrl"></div>
      <button class="copy-mini" id="copyStandardMini">Kopiér</button>
    </div>
    <div class="status" id="standardStatus"></div>
  </div>

  <p class="note">Kopiér linket og indsæt det i Nuvio under installation af addon.</p>
</section>

<section class="card">
  <h2>⚙️ Tilpas selv</h2>
  <p class="sub">Vælg præcis de kataloger, du vil have i Nuvio.</p>

  <div class="actions">
    <button class="secondary" id="all">Vælg alle</button>
    <button class="secondary" id="none">Fravælg alle</button>
  </div>

  <div class="grid" id="catalogs"></div>

  <div class="url-wrap">
    <div class="url-label"><span>Dit installationslink</span><span>Dynamisk</span></div>
    <div class="url">
      <div class="url-icon">↗</div>
      <div class="url-text" id="customUrl"></div>
      <button class="copy-mini" id="copyCustomMini">Kopiér</button>
    </div>
    <div class="status" id="customStatus"></div>
  </div>

  <div class="actions">
    <button class="primary" id="copyCustom" style="flex:1">Kopiér mit installationslink</button>
  </div>
</section>

<section class="card">
  <h2>Sådan installerer du</h2>
  <p class="note">
    <b>1.</b> Vælg standardlinket eller tilpas katalogerne.<br>
    <b>2.</b> Tryk på <b>Kopiér installationslink</b>.<br>
    <b>3.</b> Åbn Nuvio og gå til addons/installation.<br>
    <b>4.</b> Indsæt manifest-linket og installér.
  </p>
</section>

<div class="footer">Dansk Film – Nuvio · Automatisk opdaterede kataloger</div>
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
  const encoded=btoa(unescape(encodeURIComponent(ids.join(","))))
    .replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
  return base+"/c/"+encoded+"/manifest.json";
}

function update(){
  custom.textContent=urlFor();
}

async function copyText(url,button,status){
  const old=button.textContent;
  try{
    await navigator.clipboard.writeText(url);
    button.textContent="Kopieret ✓";
    status.textContent="✓ Link kopieret til udklipsholderen";
    setTimeout(()=>{
      button.textContent=old;
      status.textContent="";
    },1600);
  }catch{
    prompt("Kopiér dette link:",url);
  }
}

document.getElementById("copyStandard").addEventListener("click",()=>{
  copyText(standard,document.getElementById("copyStandard"),document.getElementById("standardStatus"));
});
document.getElementById("copyStandardMini").addEventListener("click",()=>{
  copyText(standard,document.getElementById("copyStandardMini"),document.getElementById("standardStatus"));
});
document.getElementById("copyCustom").addEventListener("click",()=>{
  copyText(urlFor(),document.getElementById("copyCustom"),document.getElementById("customStatus"));
});
document.getElementById("copyCustomMini").addEventListener("click",()=>{
  copyText(urlFor(),document.getElementById("copyCustomMini"),document.getElementById("customStatus"));
});
document.getElementById("all").addEventListener("click",()=>{
  boxes.forEach(x=>x.checked=true); update();
});
document.getElementById("none").addEventListener("click",()=>{
  boxes.forEach(x=>x.checked=false); update();
});
render();
</script>
</body></html>`;
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
