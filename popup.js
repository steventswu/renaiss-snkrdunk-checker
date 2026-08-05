const API_BASE = 'https://api.renaissos.com/v1';
const INDEX_BASE = 'https://index.renaissos.com';
const CREDENTIAL_KEYS = ['renaissApiKey', 'renaissApiSecret'];

const $ = (id) => document.getElementById(id);
const state = { card: null, rateLimit: null };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  await loadCredentials();
  const cardContext = await getActiveCardContext();
  if (cardContext) {
    await loadCard(cardContext);
  } else {
    setLoading(false);
    showSearch('Open a Renaiss card page or search the Index.');
  }
}

function bindEvents() {
  $('search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('search-input').value.trim();
    if (query.length >= 2) await searchCards(query);
  });
  $('save-settings').addEventListener('click', saveCredentials);
  $('clear-settings').addEventListener('click', clearCredentials);
  $('close-modal').addEventListener('click', () => {
    window.parent.postMessage({ source: 'renaiss-index-companion', action: 'close-modal' }, '*');
  });
}

async function getActiveCardContext() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url) return null;
  const url = new URL(tab.url);
  if (url.hostname === 'renaiss.xyz' || url.hostname === 'www.renaiss.xyz') {
    const legacyMatch = url.pathname.match(/^\/card\/([^/]+)\/?$/);
    return legacyMatch ? {
      apiPath: `/cards/by-renaiss-id/${encodeURIComponent(legacyMatch[1])}`,
      tabId: tab.id,
      legacyItemId: legacyMatch[1]
    } : null;
  }
  if (url.hostname !== 'index.renaissos.com') return null;
  const indexMatch = url.pathname.match(/^\/card\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
  return indexMatch ? { apiPath: `/cards/${indexMatch[1]}/${indexMatch[2]}/${indexMatch[3]}` } : null;
}

async function loadCard(cardContext) {
  setLoading(true);
  try {
    let card;
    try {
      // Index URLs resolve directly. Legacy Renaiss IDs may not exist in the
      // Index catalog, so those fall through to photo identification below.
      card = await apiRequest(cardContext.apiPath);
    } catch (error) {
      if (!cardContext.legacyItemId || error.status !== 404) throw error;
      card = await identifyLegacyCard(cardContext.tabId);
    }

    // FMV/trades are keyed by the API catalog UUID returned in card.id.
    const cardId = encodeURIComponent(card.id);
    const [fmv, trades] = await Promise.all([
      apiRequest(`/cards/by-id/${cardId}/fmv-series`),
      apiRequest(`/cards/by-id/${cardId}/trades`)
    ]);
    state.card = card;
    renderCard(card, fmv, trades);
  } catch (error) {
    showSearch(error.message || 'Renaiss Index data could not be loaded.');
  } finally {
    setLoading(false);
  }
}

async function searchCards(query) {
  setLoading(true);
  $('search-results').replaceChildren();
  try {
    const data = await apiRequest(`/search?q=${encodeURIComponent(query)}&limit=12`);
    if (!data.results?.length) {
      $('search-results').textContent = 'No cards found.';
      return;
    }
    data.results.forEach((card) => {
      const button = document.createElement('button');
      button.className = 'search-result';
      button.type = 'button';
      button.innerHTML = `${escapeHtml(card.name)}<span>${escapeHtml([card.setName, card.cardNumber, card.gradeLabel].filter(Boolean).join(' · '))}</span>`;
      button.addEventListener('click', () => loadCard({ apiPath: card.href.replace(/^\/card/, '/cards') }));
      $('search-results').append(button);
    });
  } catch (error) {
    $('search-results').textContent = error.message || 'Search failed.';
  } finally {
    setLoading(false);
  }
}

async function identifyLegacyCard(tabId) {
  let metadata;
  try {
    metadata = await chrome.tabs.sendMessage(tabId, { action: 'getCardMetadata' });
  } catch (error) {
    // The user may have opened the page before loading/reloading the unpacked
    // extension. Inject the read-only bridge once instead of requiring a page reload.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      metadata = await chrome.tabs.sendMessage(tabId, { action: 'getCardMetadata' });
    } catch (injectionError) {
      throw new Error('Reload the Renaiss card page so the companion can read its card image.');
    }
  }
  if (!metadata?.imageUrl) {
    if (!metadata?.serial) throw new Error('No card image or certification number was found on this Renaiss page.');
  }

  // Prefer the slab cert when the legacy page exposes one: this preserves the
  // exact grading company and grade instead of falling back to a representative
  // grade for the visually matched card.
  if (metadata.serial) {
    try {
      const graded = await apiRequest(`/graded/${encodeURIComponent(metadata.serial)}`);
      if (graded.found && graded.card?.href) {
        return apiRequest(graded.card.href.replace(/^\/card/, '/cards'));
      }
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  if (!metadata.imageUrl) {
    throw new Error('No card image was found on this Renaiss page.');
  }

  const imageResponse = await fetch(metadata.imageUrl);
  if (!imageResponse.ok) throw new Error('The card image could not be read for identification.');
  const imageBlob = await imageResponse.blob();
  const form = new FormData();
  form.append('file', imageBlob, 'renaiss-card.jpg');
  const match = await apiRequest('/search/by-image?limit=5', { method: 'POST', body: form });
  if (!match.ids?.length || match.confidence === 'low' || match.confidence === 'none') {
    throw new Error('The card image match was uncertain. Try a clearer card image.');
  }
  return apiRequest(`/cards/by-id/${encodeURIComponent(match.ids[0])}`);
}

async function apiRequest(path, options = {}) {
  const credentials = await chrome.storage.session.get(CREDENTIAL_KEYS);
  if (!credentials.renaissApiKey || !credentials.renaissApiSecret) {
    throw new Error('Enter both Renaiss API credentials in API access before loading Index data.');
  }
  const headers = { Accept: 'application/json' };
  headers['X-Api-Key'] = credentials.renaissApiKey;
  headers['X-Api-Secret'] = credentials.renaissApiSecret;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  updateRateLimit(response.headers);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 429) throw new Error('API rate limit reached. Add your Renaiss API credentials below and try again.');
    const error = new Error(body.error || body.message || `Renaiss API request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function renderCard(card, fmv, trades) {
  $('card-panel').classList.remove('is-hidden');
  $('search-panel').classList.add('is-hidden');
  $('message-state').classList.add('is-hidden');
  $('card-name').textContent = card.name;
  $('card-meta').textContent = [card.setName, card.cardNumber, card.variation, card.language].filter(Boolean).join(' · ');
  $('grade-label').textContent = card.gradeLabel || [card.company, card.grade].filter(Boolean).join(' ');
  $('fmv-price').textContent = formatUsd(card.priceUsdCents);
  $('confidence').textContent = card.confidence ? `${card.confidence} confidence` : 'Price confidence unavailable';
  renderDelta('delta-7', card.deltas?.d7);
  renderDelta('delta-30', card.deltas?.d30);
  renderDelta('delta-365', card.deltas?.d365);
  $('source-count').textContent = formatNumber(card.sourceCount);
  $('observation-count').textContent = formatNumber(card.observationCount);
  $('last-sale').textContent = formatDate(card.lastSaleAt || card.updatedAt);
  $('source-summary').textContent = (card.sourceBreakdown || [])
    .map((source) => `${source.displayName} (${formatNumber(source.count)})`)
    .join(' · ');
  renderImage(card);
  renderChart(fmv?.points || []);
  renderGrades(card.otherGrades || []);
  renderTrades(trades?.trades || [], trades?.total);
  const cardUrl = `${INDEX_BASE}${card.href}`;
  $('open-card').href = cardUrl;
  $('open-card').classList.remove('is-hidden');
}

function renderImage(card) {
  const image = $('card-image');
  if (!card.imageUrl) return image.classList.add('is-hidden');
  image.src = card.imageUrl;
  image.alt = card.name;
  image.classList.remove('is-hidden');
}

function renderDelta(id, value) {
  const el = $(id);
  el.classList.remove('positive', 'negative');
  if (typeof value !== 'number') return (el.textContent = '—');
  el.textContent = `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
  el.classList.add(value >= 0 ? 'positive' : 'negative');
}

function renderChart(points) {
  const valid = points.filter((point) => Number.isFinite(point.usdCents));
  $('chart-caption').textContent = valid.length ? `${valid.length} daily points` : 'No history';
  if (valid.length < 2) {
    $('chart').innerHTML = '<div class="chart-empty">No FMV history available.</div>';
    return;
  }
  const values = valid.map((point) => point.usdCents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 360;
  const height = 92;
  const path = valid.map((point, index) => {
    const x = (index / (valid.length - 1)) * width;
    const y = height - ((point.usdCents - min) / range) * height;
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  $('chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#72d6bb" stop-opacity=".35"/><stop offset="1" stop-color="#72d6bb" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#fill)"/><path d="${path}" fill="none" stroke="#72d6bb" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderGrades(grades) {
  const section = $('other-grades-section');
  const list = $('other-grades');
  list.replaceChildren();
  const relevant = grades.filter((grade) => grade.priceUsdCents != null).slice(0, 6);
  if (!relevant.length) return section.classList.add('is-hidden');
  relevant.forEach((grade) => {
    const row = document.createElement('div');
    row.className = 'grade-row';
    row.innerHTML = `<span>${escapeHtml(grade.gradeLabel || [grade.company, grade.grade].filter(Boolean).join(' '))}</span><strong>${formatUsd(grade.priceUsdCents)}</strong>`;
    list.append(row);
  });
  section.classList.remove('is-hidden');
}

function renderTrades(trades, total) {
  const list = $('trades');
  list.replaceChildren();
  $('trade-total').textContent = Number.isFinite(total) ? `${formatNumber(total)} total` : '';
  const priced = trades.filter((trade) => trade.priceUsdCents != null).slice(0, 5);
  if (!priced.length) {
    list.innerHTML = '<p class="muted">No market observations available.</p>';
    return;
  }
  priced.forEach((trade) => {
    const row = document.createElement('div');
    row.className = 'trade-row';
    row.innerHTML = `<div><strong>${escapeHtml(trade.displayName || trade.source)}</strong><span>${escapeHtml([trade.kind, formatDate(trade.observedAt)].filter(Boolean).join(' · '))}</span></div><strong>${formatUsd(trade.priceUsdCents)}</strong>`;
    list.append(row);
  });
}

function showSearch(message) {
  $('card-panel').classList.add('is-hidden');
  $('message-state').classList.remove('is-hidden');
  $('search-panel').classList.remove('is-hidden');
  $('message-title').textContent = 'Find a Renaiss Index card';
  $('message-detail').textContent = message;
}

function setLoading(loading) {
  $('loading-state').classList.toggle('is-hidden', !loading);
  if (loading) $('message-state').classList.add('is-hidden');
}

async function loadCredentials() {
  const { renaissApiKey = '', renaissApiSecret = '' } = await chrome.storage.session.get(CREDENTIAL_KEYS);
  $('api-key').value = renaissApiKey;
  $('api-secret').value = renaissApiSecret;
}

async function saveCredentials() {
  const renaissApiKey = $('api-key').value.trim();
  const renaissApiSecret = $('api-secret').value.trim();
  if (!renaissApiKey || !renaissApiSecret) {
    $('rate-limit').textContent = 'Enter both the API key and secret.';
    return;
  }
  await chrome.storage.session.set({ renaissApiKey, renaissApiSecret });
  $('rate-limit').textContent = 'Saved for this browser session only. Reload the popup to fetch Index data.';
}

async function clearCredentials() {
  await chrome.storage.session.remove(CREDENTIAL_KEYS);
  $('api-key').value = '';
  $('api-secret').value = '';
  $('rate-limit').textContent = 'Credentials cleared.';
}

function updateRateLimit(headers) {
  const remaining = headers.get('X-RateLimit-Remaining');
  const limit = headers.get('X-RateLimit-Limit');
  if (remaining && limit) $('rate-limit').textContent = `API requests remaining: ${remaining} of ${limit}.`;
}

function formatUsd(cents) {
  if (!Number.isFinite(cents)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function formatNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : '—';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
