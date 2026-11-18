// ============================================================
//  Nothing News Widget — lógica del frontend
// ============================================================

const CONFIG = {
  forum: "https://nothing.community",
  // Slug de la etiqueta del foro. "newsroom" = anuncios oficiales.
  // Si no existe o no devuelve nada, el widget cae a "últimas del foro".
  tag: localStorage.getItem("nnw.tag") ?? "newsroom",
  limit: 8,
  refreshMinutes: 10,
};

const tauri = window.__TAURI__ ?? null;
const $ = (id) => document.getElementById(id);
const list = $("list");
const statusEl = $("status");

let lastUpdate = null;
let loading = false;

// ---------- Estado persistente ----------
const seen = new Set(JSON.parse(localStorage.getItem("nnw.seen") ?? "[]"));
function markSeen(id) {
  seen.add(id);
  localStorage.setItem("nnw.seen", JSON.stringify([...seen].slice(-200)));
}

// ---------- Datos ----------
async function requestFeed(tag) {
  if (!tauri) return mockFeed(); // vista previa en navegador
  const raw = await tauri.core.invoke("fetch_news", { tag, limit: CONFIG.limit });
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

    return {
      id: d.id,
      title: a.title ?? "(sin título)",
      url: `${CONFIG.forum}/d/${d.id}${a.slug ? "-" + a.slug : ""}`,
      createdAt: new Date(a.createdAt ?? a.lastPostedAt ?? Date.now()),
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

function renderItems(items) {
  list.replaceChildren(
    ...items.map((item) => {
      const btn = document.createElement("button");
      btn.className = "item";
      btn.title = item.title;

      const meta = document.createElement("div");
      meta.className = "item-meta";
      // No repetimos la etiqueta si es la misma que el feed que estamos viendo.
      if (item.tag && item.tag.toLowerCase() !== CONFIG.tag.toLowerCase()) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = item.tag;
        meta.append(chip);
      }
      const when = document.createElement("span");
      when.textContent = [timeAgo(item.createdAt), item.replies ? `${item.replies} resp.` : ""]
        .filter(Boolean).join(" · ");
      meta.append(when);
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
}

function renderSkeleton() {
  list.innerHTML = Array.from({ length: 4 },
    () => '<div class="skeleton"><div></div><div></div><div></div></div>').join("");
}

function renderState(title, text, withRetry = false) {
  list.innerHTML = "";
  const box = document.createElement("div");
  box.className = "state";
  box.innerHTML = `<div class="state-title"></div><p></p>`;
  box.querySelector(".state-title").textContent = title;
  box.querySelector("p").textContent = text;
  if (withRetry) {
    const b = document.createElement("button");
    b.textContent = "Reintentar";
    b.onclick = () => load();
    box.append(b);
  }
  list.append(box);
}

function updateStatus() {
  if (!lastUpdate) return;
  statusEl.textContent = `Act. ${timeAgo(lastUpdate)}${tauri ? "" : " · demo"}`;
}

// ---------- Carga ----------
async function load() {
  if (loading) return;
  loading = true;
  $("btnRefresh").classList.add("spinning");
  if (!list.querySelector(".item")) renderSkeleton();

  try {
    let label = CONFIG.tag ? CONFIG.tag.toUpperCase() : "FORO";
    let items = parseFlarum(await requestFeed(CONFIG.tag));

    // Si la etiqueta no da resultados, mostramos lo último del foro.
    if (!items.length && CONFIG.tag) {
      items = parseFlarum(await requestFeed(null));
      label = "FORO";
    }

    $("feedLabel").textContent = label;
    if (items.length) renderItems(items);
    else renderState("NADA", "No hay publicaciones que mostrar.");
    lastUpdate = new Date();
    updateStatus();
  } catch (err) {
    console.error(err);
    if (!list.querySelector(".item")) {
      renderState("SIN CONEXIÓN", String(err), true);
    }
    statusEl.textContent = "Error al actualizar";
  } finally {
    loading = false;
    $("btnRefresh").classList.remove("spinning");
  }
}

// ---------- Acciones de ventana ----------
function openUrl(url) {
  if (tauri) tauri.opener.openUrl(url);
  else window.open(url, "_blank");
}

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
load();
setInterval(load, CONFIG.refreshMinutes * 60 * 1000);
setInterval(updateStatus, 30 * 1000);
window.addEventListener("focus", () => {
  if (!lastUpdate || Date.now() - lastUpdate > 5 * 60 * 1000) load();
});

// ---------- Datos de ejemplo (solo al abrir index.html en un navegador) ----------
function mockFeed() {
  const h = (n) => new Date(Date.now() - n * 3600 * 1000).toISOString();
  const disc = (id, title, slug, created, comments, tag, post) => ({
    type: "discussions", id: String(id),
    attributes: { title, slug, createdAt: created, commentCount: comments },
    relationships: {
      user: { data: { type: "users", id: "1" } },
      tags: { data: [{ type: "tags", id: tag }] },
      firstPost: { data: { type: "posts", id: "p" + id } },
    },
  });
  return {
    data: [
      disc(101, "Ejemplo: actualización de sistema disponible para todos", "ejemplo-1", h(2), 48, "1", "p"),
      disc(102, "Ejemplo: nuevo evento de la comunidad este fin de semana", "ejemplo-2", h(20), 12, "1", "p"),
      disc(103, "Ejemplo: changelog de la app de auriculares", "ejemplo-3", h(52), 7, "2", "p"),
      disc(104, "Ejemplo: resultados de la votación de la comunidad", "ejemplo-4", h(170), 91, "1", "p"),
    ],
    included: [
      { type: "users", id: "1", attributes: { displayName: "Nothing Team" } },
      { type: "tags", id: "1", attributes: { name: "Newsroom", isPrimary: true } },
      { type: "tags", id: "2", attributes: { name: "Updates" } },
      ...[101, 102, 103, 104].map((id) => ({
        type: "posts", id: "p" + id,
        attributes: { contentHtml: "<p>Texto de ejemplo del primer mensaje. En la app real aquí aparece el inicio de la publicación del foro.</p>" },
      })),
    ],
  };
}
