const BREAKING_KEY = 'sami-news-last-top-url';
const SETTINGS_KEY = 'sapmi-dal-settings-v1';

function fmtDate(iso) {
  if (!iso) return 'amas áigi';
  const d = new Date(iso);

  const monthsGen = [
    'ođđajagemánu', 'guovvamánu', 'njukčamánu', 'cuoŋománu',
    'miessemánu', 'geassemánu', 'suoidnemánu', 'borgemánu',
    'čakčamánu', 'golggotmánu', 'skábmamánu', 'juovlamánu'
  ];

  const day = d.getDate();
  const month = monthsGen[d.getMonth()] || '';
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');

  return `${day}. ${month} ${year}, ${hh}:${mm}`;
}

function imageTag(item, cls='thumb') {
  if (!item.image_url) return '';
  return `<img class="${cls}" src="${item.image_url}" alt="" loading="lazy" referrerpolicy="no-referrer"/>`;
}

function card(item) {
  return `<article class="card">
    ${imageTag(item)}
    <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a>
    <div class="meta">${item.source} · ${fmtDate(item.published_at)}</div>
  </article>`;
}

function quickItem(item) {
  return `<div class="qitem">
    ${imageTag(item, 'qthumb')}
    <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.title}</a>
    <div class="meta">${item.source}</div>
  </div>`;
}

function renderGrid(el, items) {
  if (!items.length) {
    el.innerHTML = `<article class="card"><div class="meta">Eai leat ođđasat dál.</div></article>`;
    return;
  }
  el.innerHTML = items.map(card).join('');
}

function bySource(items, list) {
  return items.filter(i => list.includes(i.source));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function applySettings(items, settings) {
  const enabled = settings.enabledSources || {};
  const hasEnabled = Object.keys(enabled).length > 0;
  const limits = settings.perSourceLimit || {};

  const filtered = items.filter(i => !hasEnabled || enabled[i.source] !== false);
  const seen = {};
  const out = [];
  for (const item of filtered) {
    const src = item.source || 'Eará';
    const lim = Number(limits[src]);
    const max = Number.isFinite(lim) && lim > 0 ? lim : Infinity;
    seen[src] = (seen[src] || 0);
    if (seen[src] >= max) continue;
    seen[src] += 1;
    out.push(item);
  }
  return out;
}

function renderSettingsPanel(sources) {
  const wrap = document.getElementById('settingsSources');
  const settings = loadSettings();
  const enabled = settings.enabledSources || {};
  const limits = settings.perSourceLimit || {};

  wrap.innerHTML = sources.map(src => {
    const checked = enabled[src] !== false;
    const val = limits[src] || '';
    return `<label class="settings-row">
      <span><input type="checkbox" data-source="${src}" ${checked ? 'checked' : ''}/> ${src}</span>
      <input type="number" min="1" step="1" data-limit="${src}" value="${val}" placeholder="buot" />
    </label>`;
  }).join('');
}

function wireSettingsUI(sources) {
  const btn = document.getElementById('settingsBtn');
  const panel = document.getElementById('settingsPanel');
  const close = document.getElementById('settingsClose');
  const save = document.getElementById('settingsSave');
  const reset = document.getElementById('settingsReset');

  btn.onclick = () => {
    renderSettingsPanel(sources);
    panel.classList.toggle('hidden');
  };
  close.onclick = () => panel.classList.add('hidden');
  reset.onclick = () => {
    localStorage.removeItem(SETTINGS_KEY);
    renderSettingsPanel(sources);
  };
  save.onclick = () => {
    const enabledSources = {};
    const perSourceLimit = {};
    panel.querySelectorAll('[data-source]').forEach(el => {
      enabledSources[el.dataset.source] = el.checked;
    });
    panel.querySelectorAll('[data-limit]').forEach(el => {
      const v = (el.value || '').trim();
      if (v) perSourceLimit[el.dataset.limit] = Number(v);
    });
    saveSettings({ enabledSources, perSourceLimit });
    panel.classList.add('hidden');
    load();
  };
}

function topScore(item) {
  const title = (item.title || '').toLowerCase();
  const source = item.source || '';

  // Freshness boost (0-40) over last 24h
  let freshness = 0;
  if (item.published_at) {
    const ageHours = (Date.now() - new Date(item.published_at).getTime()) / 36e5;
    freshness = Math.max(0, 40 - Math.min(40, ageHours * 1.7));
  }

  // Source trust/editorial relevance (tunable)
  const sourceWeight = {
    'NRK Sápmi': 20,
    'Yle Sápmi': 16,
    'Ávvir': 15,
    'Ságat': 14,
    'SVT Norrbotten': 12,
  }[source] || 6;

  // Headline importance keywords
  const importantWords = [
    'krise', 'kritikk', 'ulykke', 'dø', 'død', 'drap', 'aksjon', 'streik',
    'vedtak', 'budsjett', 'rett', 'dom', 'valg', 'regjering', 'sametinget',
    'beredskap', 'stenger', 'konkurs', 'resultat', 'guidance', 'contract'
  ];
  const keywordHits = importantWords.reduce((n, w) => n + (title.includes(w) ? 1 : 0), 0);

  // Slight boost for substantive headlines
  const lengthBoost = Math.min(8, Math.floor((item.title || '').length / 22));

  return freshness + sourceWeight + keywordHits * 7 + lengthBoost;
}

function samiWeekday(now = new Date()) {
  const names = ['sotnabeaivi', 'vuossárga', 'maŋŋebárga', 'gaskavahkku', 'duorasdat', 'bearjadat', 'lávvardat'];
  return names[now.getDay()];
}

function setTopline() {
  const el = document.getElementById('topline');
  if (!el) return;
  const day = samiWeekday();
  // Capitalize first letter to match style
  const dayCap = day.charAt(0).toUpperCase() + day.slice(1);
  el.textContent = `Kárášjohka · Sápmi · ${dayCap}`;
}

function showBreaking(top) {
  const bar = document.getElementById('breaking');
  const previous = localStorage.getItem(BREAKING_KEY);
  if (previous && previous !== top.url) {
    bar.classList.remove('hidden');
    bar.innerHTML = `🚨 BREAKING: <a style="color:#fff;text-decoration:underline" href="${top.url}" target="_blank" rel="noopener noreferrer">${top.title}</a>`;
  }
  localStorage.setItem(BREAKING_KEY, top.url);
}

function countryFor(item) {
  const source = item.source || '';
  if (['NRK Sápmi', 'Ávvir', 'Ságat'].includes(source)) return 'Norga';
  if (source === 'SVT Norrbotten') return 'Ruoŧŧa';
  if (source === 'Yle Sápmi') return 'Suopma';
  return 'Ruošša';
}

async function load() {
  setTopline();
  const res = await fetch('data/news.json?ts=' + Date.now());
  const data = await res.json();
  const allItems = data.items || [];
  const baseItems = allItems.filter(i => i.source !== 'Vow ASA');

  const sources = [...new Set(baseItems.map(i => i.source).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  if (!window.__settingsWired) {
    wireSettingsUI(sources);
    window.__settingsWired = true;
  }

  const items = applySettings(baseItems, loadSettings());

  const hero = document.getElementById('hero');
  const quick = document.getElementById('quick');
  const updated = document.getElementById('updated');

  const norgaGrid = document.getElementById('norga');
  const ruottaGrid = document.getElementById('ruotta');
  const suopmaGrid = document.getElementById('suopma');
  const ruossaGrid = document.getElementById('ruossa');

  if (!items.length) {
    hero.innerHTML = '<p>Eai leat ođđasat gávdnon dál.</p>';
    return;
  }

  const ranked = [...items].sort((a, b) => topScore(b) - topScore(a));
  const top = ranked[0];
  showBreaking(top);

  hero.innerHTML = `${imageTag(top, 'heroimg')}<a href="${top.url}" target="_blank" rel="noopener noreferrer">${top.title}</a>
    <div class="meta">${top.source} · ${fmtDate(top.published_at)}</div>`;

  quick.innerHTML = ranked.filter(i => i.url !== top.url).slice(0, 4).map(quickItem).join('');

  // Ensure each article appears in ONE category only
  const used = new Set([top.url]);
  const take = (arr, max) => {
    const out = [];
    for (const item of arr) {
      if (out.length >= max) break;
      if (used.has(item.url)) continue;
      used.add(item.url);
      out.push(item);
    }
    return out;
  };

  const norgaCandidates = ranked.filter(i => countryFor(i) === 'Norga');
  const ruottaCandidates = ranked.filter(i => countryFor(i) === 'Ruoŧŧa');
  const suopmaCandidates = ranked.filter(i => countryFor(i) === 'Suopma');
  const ruossaCandidates = ranked.filter(i => countryFor(i) === 'Ruošša');

  const norga = take(norgaCandidates, 30);
  const ruotta = take(ruottaCandidates, 30);
  const suopma = take(suopmaCandidates, 30);
  const ruossa = take(ruossaCandidates, 30);

  renderGrid(norgaGrid, norga);
  renderGrid(ruottaGrid, ruotta);
  renderGrid(suopmaGrid, suopma);
  renderGrid(ruossaGrid, ruossa);

  updated.textContent = `Maŋimus ođasmahtton: ${fmtDate(data.updated_at)} · ${items.length}/${data.count} ášši`;
}

load();
setInterval(load, 60000);
