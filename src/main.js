// ============================================================
//  Nothing News Widget — lógica del frontend
// ============================================================

const CONFIG = {
  forum: "https://nothing.community",
  limit: 8,
  refreshMinutes: 10,
  // Slug de la etiqueta de anuncios oficiales (se puede cambiar con localStorage "nnw.tag").
  newsroomTag: localStorage.getItem("nnw.tag") ?? "newsroom",
  popularDays: 7,
};

/**
 * Las tres vistas del selector.
 *  - request: parámetros que se mandan al comando Rust `fetch_news`.
 *  - dateField: qué fecha se muestra en cada noticia.
 *  - pick: cómo se filtran/ordenan los resultados antes de pintarlos.
 */
const FEEDS = {
  newsroom: {
    request: () => ({ tag: CONFIG.newsroomTag, sort: "-createdAt", limit: CONFIG.limit }),
    dateField: "createdAt",
    pick: (items) => items,
  },
  portada: {
    // Igual que la home del foro: ordenado por última actividad.
    request: () => ({ tag: null, sort: "-lastPostedAt", limit: CONFIG.limit }),
    dateField: "lastPostedAt",
    pick: (items) => items,
  },
  populares: {
    // Traemos las 50 más nuevas y nos quedamos con las de más respuestas de los últimos días.
    request: () => ({ tag: null, sort: "-createdAt", limit: 50 }),
    dateField: "createdAt",
    pick: (items) => {
      const since = Date.now() - CONFIG.popularDays * 86400 * 1000;
      return items
        .filter((i) => i.createdAt >= since && i.replies > 0)
        .sort((a, b) => b.replies - a.replies)
        .slice(0, CONFIG.limit);
    },
  },
};

const tauri = window.__TAURI__ ?? null;
const $ = (id) => document.getElementById(id);
const list = $("list");
const statusEl = $("status");
const tabs = [...document.querySelectorAll(".tab")];

let currentFeed = FEEDS[localStorage.getItem("nnw.feed")] ? localStorage.getItem("nnw.feed") : "newsroom";
let lastUpdate = null;
let requestId = 0; // para descartar respuestas viejas si cambias de pestaña rápido

// ---------- Estado persistente ----------
const seen = new Set(JSON.parse(localStorage.getItem("nnw.seen") ?? "[]"));
function markSeen(id) {
  seen.add(id);
  localStorage.setItem("nnw.seen", JSON.stringify([...seen].slice(-300)));
}

// ---------- Datos ----------
async function requestFeed(params) {
  if (!tauri) return mockFeed(params); // vista previa en navegador
  const raw = await tauri.core.invoke("fetch_news", params);
  return JSON.parse(raw);
}

/** Convierte la respuesta JSON:API de Flarum en objetos simples. */
function parseFlarum(json) {
  const included = new Map(
    (json.included ?? []).map((r) => [`${r.type}:${r.id}`, r])
  );
  const rel = (d, name) => d.relationships?.[name]?.data;
  const get = (ref) => (ref ? included.get(`${ref.type}:${ref.id}`) : null);

  return (json.data ?? []).map((d) => {
    const a = d.attributes ?? {};
    const user = get(rel(d, "user"));
    const tags = (rel(d, "tags") ?? []).map(get).filter(Boolean);
    // Mostramos la etiqueta "hija" si la hay (suele ser la más concreta).
    const tag = tags.find((t) => !t.attributes?.isPrimary) ?? tags[0];
    const firstPost = get(rel(d, "firstPost"));
    const createdAt = new Date(a.createdAt ?? a.lastPostedAt ?? Date.now());

    return {
      id: d.id,
      title: a.title ?? "(sin título)",
      url: `${CONFIG.forum}/d/${d.id}${a.slug ? "-" + a.slug : ""}`,
      createdAt,
      lastPostedAt: a.lastPostedAt ? new Date(a.lastPostedAt) : createdAt,
      replies: Math.max(0, (a.commentCount ?? 1) - 1),
      author: user?.attributes?.displayName ?? user?.attributes?.username ?? "",
      tag: tag?.attributes?.name ?? "",
      excerpt: htmlToText(firstPost?.attributes?.contentHtml ?? ""),
    };
  });
}

function htmlToText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}

// ---------- Render ----------
const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto", style: "short" });
function timeAgo(date) {
  const s = (date - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800],
                 ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, secs] of units) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  }
  return "ahora";
}

function isNew(item) {
  const week = 7 * 86400 * 1000;
  return !seen.has(item.id) && Date.now() - item.createdAt < week;
}

function renderItems(items, feedKey) {
  const feed = FEEDS[feedKey];
  list.replaceChildren(
    ...items.map((item) => {
      const btn = document.createElement("button");
      btn.className = "item";
      btn.title = item.title;

      const meta = document.createElement("div");
      meta.className = "item-meta";

      // En Newsroom no repetimos la etiqueta "Newsroom" en cada noticia.
      const hideTag = feedKey === "newsroom" &&
        item.tag.toLowerCase() === CONFIG.newsroomTag.toLowerCase();
      if (item.tag && !hideTag) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = item.tag;
        meta.append(chip);
      }

      const date = item[feed.dateField];
      const when = feedKey === "portada" ? `activo ${timeAgo(date)}` : timeAgo(date);
      const parts = feedKey === "populares"
        ? [`${item.replies} resp.`, when]
        : [when, item.replies ? `${item.replies} resp.` : ""];
      const info = document.createElement("span");
      info.textContent = parts.filter(Boolean).join(" · ");
      meta.append(info);

      if (isNew(item)) {
        const dot = document.createElement("span");
        dot.className = "new-dot";
        dot.title = "Nuevo";
        meta.append(dot);
      }

      const title = document.createElement("div");
      title.className = "item-title";
      title.textContent = item.title;
      btn.append(meta, title);

      if (item.excerpt) {
        const ex = document.createElement("div");
        ex.className = "item-excerpt";
        ex.textContent = item.excerpt;
        btn.append(ex);
      }

      btn.addEventListener("click", () => {
        markSeen(item.id);
        btn.querySelector(".new-dot")?.remove();
        openUrl(item.url);
      });
      return btn;
    })
  );
  list.scrollTop = 0;
}

function renderSkeleton() {
  list.innerHTML = Array.from({ length: 4 },
    () => '<div class="skeleton"><div></div><div></div><div></div></div>').join("");
}

/** Pantalla de estado (vacío o error) con un botón opcional. */
function renderState(title, text, action) {
  list.innerHTML = "";
  const box = document.createElement("div");
  box.className = "state";
  const t = document.createElement("div");
  t.className = "state-title";
  t.textContent = title;
  const p = document.createElement("p");
  p.textContent = text;
  box.append(t, p);
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = action.run;
    box.append(b);
  }
  list.append(box);
}

function updateStatus() {
  if (!lastUpdate) return;
  statusEl.textContent = `Act. ${timeAgo(lastUpdate)}${tauri ? "" : " · demo"}`;
}

// ---------- Carga ----------
async function load({ showSkeleton = false } = {}) {
  const myId = ++requestId;
  const feedKey = currentFeed;
  const feed = FEEDS[feedKey];

  $("btnRefresh").classList.add("spinning");
  if (showSkeleton || !list.querySelector(".item")) renderSkeleton();

  try {
    const items = feed.pick(parseFlarum(await requestFeed(feed.request())));
    if (myId !== requestId) return; // el usuario ya cambió de pestaña

    if (items.length) {
      renderItems(items, feedKey);
    } else if (feedKey === "newsroom") {
      renderState("NADA", "No hay publicaciones en Newsroom.", {
        label: "Ver portada", run: () => selectFeed("portada"),
      });
    } else if (feedKey === "populares") {
      renderState("NADA", `Sin discusiones con respuestas en los últimos ${CONFIG.popularDays} días.`);
    } else {
      renderState("NADA", "No hay publicaciones que mostrar.");
    }
    lastUpdate = new Date();
    updateStatus();
  } catch (err) {
    if (myId !== requestId) return;
    console.error(err);
    if (!list.querySelector(".item")) {
      renderState("SIN CONEXIÓN", String(err), { label: "Reintentar", run: () => load() });
    }
    statusEl.textContent = "Error al actualizar";
  } finally {
    if (myId === requestId) $("btnRefresh").classList.remove("spinning");
  }
}

function selectFeed(key) {
  currentFeed = key;
  localStorage.setItem("nnw.feed", key);
  tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.feed === key)));
  load({ showSkeleton: true });
}

// ---------- Acciones ----------
function openUrl(url) {
  if (tauri) tauri.opener.openUrl(url);
  else window.open(url, "_blank");
}

tabs.forEach((t) => (t.onclick = () => t.dataset.feed !== currentFeed && selectFeed(t.dataset.feed)));
$("btnRefresh").onclick = () => load();
$("openForum").onclick = (e) => { e.preventDefault(); openUrl(CONFIG.forum); };
$("btnClose").onclick = () => tauri?.window.getCurrentWindow().close();

const pinBtn = $("btnPin");
async function setPinned(on) {
  pinBtn.setAttribute("aria-pressed", String(on));
  localStorage.setItem("nnw.pinned", on ? "1" : "0");
  await tauri?.window.getCurrentWindow().setAlwaysOnTop(on);
}
pinBtn.onclick = () => setPinned(pinBtn.getAttribute("aria-pressed") !== "true");

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("nnw.theme", theme);
}
$("btnTheme").onclick = () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

// ---------- Arranque ----------
setTheme(localStorage.getItem("nnw.theme") ?? "dark");
setPinned(localStorage.getItem("nnw.pinned") === "1");
selectFeed(currentFeed);
setInterval(() => load(), CONFIG.refreshMinutes * 60 * 1000);
setInterval(updateStatus, 30 * 1000);
window.addEventListener("focus", () => {
  if (!lastUpdate || Date.now() - lastUpdate > 5 * 60 * 1000) load();
});

// ---------- Datos de ejemplo (solo al abrir index.html en un navegador) ----------
function mockFeed({ tag, sort }) {
  const h = (n) => new Date(Date.now() - n * 3600 * 1000).toISOString();
  const rows = tag
    ? [
        ["Ejemplo: actualización de sistema disponible para todos", 2, 48, "1"],
        ["Ejemplo: nuevo evento de la comunidad este fin de semana", 20, 12, "1"],
        ["Ejemplo: resultados de la votación de la comunidad", 170, 91, "1"],
      ]
    : [
        ["Ejemplo: ¿cómo cambio el estilo de los Glyphs?", 1, 3, "2"],
        ["Ejemplo: changelog de la app de auriculares", 5, 7, "3"],
        ["Ejemplo: review tras un mes de uso", 30, 64, "4"],
        ["Ejemplo: fondos de pantalla de la comunidad", 50, 120, "4"],
        ["Ejemplo: problema con la batería tras actualizar", 70, 35, "2"],
      ];
  const data = rows.map(([title, hours, comments, tagId], i) => ({
    type: "discussions", id: String(100 + i),
    attributes: {
      title, slug: "ejemplo-" + i, createdAt: h(hours),
      lastPostedAt: h(sort === "-lastPostedAt" ? i * 0.5 : hours), commentCount: comments,
    },
    relationships: {
      user: { data: { type: "users", id: "1" } },
      tags: { data: [{ type: "tags", id: tagId }] },
      firstPost: { data: { type: "posts", id: "p" } },
    },
  }));
  return {
    data,
    included: [
      { type: "users", id: "1", attributes: { displayName: "Nothing Team" } },
      { type: "tags", id: "1", attributes: { name: "Newsroom" } },
      { type: "tags", id: "2", attributes: { name: "Help" } },
      { type: "tags", id: "3", attributes: { name: "Updates" } },
      { type: "tags", id: "4", attributes: { name: "Community" } },
      { type: "posts", id: "p", attributes: { contentHtml: "<p>Texto de ejemplo del primer mensaje. En la app real aquí aparece el inicio de la publicación.</p>" } },
    ],
  };
}
