import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const API_BASE = 'https://api.renaissos.com/v1';
const INDEX_BASE = 'https://index.renaissos.com';
const CREDENTIAL_KEYS = ['renaissApiKey', 'renaissApiSecret'];

function cardContextForUrl(rawUrl, tabId) {
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  if (url.hostname === 'renaiss.xyz' || url.hostname === 'www.renaiss.xyz') {
    const match = url.pathname.match(/^\/card\/([^/]+)\/?$/);
    return match && { apiPath: `/cards/by-renaiss-id/${encodeURIComponent(match[1])}`, tabId, legacyItemId: match[1] };
  }
  if (url.hostname === 'index.renaissos.com') {
    const match = url.pathname.match(/^\/card\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
    return match && { apiPath: `/cards/${match[1]}/${match[2]}/${match[3]}`, tabId };
  }
  return null;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function request(path, credentials, onRateLimit, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: options.cache || 'no-store',
    headers: {
      Accept: 'application/json',
      'X-Api-Key': credentials.renaissApiKey,
      'X-Api-Secret': credentials.renaissApiSecret,
      ...(options.headers || {})
    }
  });
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const limit = response.headers.get('X-RateLimit-Limit');
  if (remaining && limit) onRateLimit(`API requests remaining: ${remaining} of ${limit}.`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || body.message || `Renaiss API request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function identifyLegacyCard(context, credentials, onRateLimit, signal, currentMetadata) {
  const metadata = currentMetadata?.ready
    ? currentMetadata
    : await chrome.tabs.sendMessage(context.tabId, { action: 'getCardMetadata' });
  if (metadata?.serial) {
    try {
      const graded = await request(`/graded/${encodeURIComponent(metadata.serial)}`, credentials, onRateLimit, { signal });
      if (graded.found && graded.card?.href) return request(graded.card.href.replace(/^\/card/, '/cards'), credentials, onRateLimit, { signal });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  if (!metadata?.imageUrl) throw new Error('No card image or certification number was found on this Renaiss page.');
  const image = await fetch(metadata.imageUrl, { signal });
  if (!image.ok) throw new Error('The card image could not be read for identification.');
  const form = new FormData();
  form.append('file', await image.blob(), 'renaiss-card.jpg');
  const match = await request('/search/by-image?limit=5', credentials, onRateLimit, { method: 'POST', body: form, signal });
  if (!match.ids?.length || match.confidence === 'low' || match.confidence === 'none') throw new Error('The card image match was uncertain. Try a clearer card image.');
  return request(`/cards/by-id/${encodeURIComponent(match.ids[0])}`, credentials, onRateLimit, { signal });
}

async function resolveCard(context, metadata, credentials, onRateLimit, signal) {
  try {
    return await request(context.apiPath, credentials, onRateLimit, { signal });
  } catch (error) {
    if (!context.legacyItemId || error.status !== 404) throw error;
    return identifyLegacyCard(context, credentials, onRateLimit, signal, metadata);
  }
}

function App() {
  const initialCardUrl = new URLSearchParams(window.location.search).get('cardUrl');
  const [credentials, setCredentials] = useState(null);
  const [cardTarget, setCardTarget] = useState({ url: initialCardUrl, revision: 0 });
  const [cardState, setCardState] = useState({ status: 'idle', card: null, fmv: null, trades: null, error: '' });
  const [indices, setIndices] = useState(null);
  const [rateLimit, setRateLimit] = useState('');
  const requestVersion = useRef(0);

  useEffect(() => {
    Promise.all([chrome.storage.session.get(CREDENTIAL_KEYS), activeTab()]).then(([saved, tab]) => {
      setCredentials({ renaissApiKey: saved.renaissApiKey || '', renaissApiSecret: saved.renaissApiSecret || '' });
      if (!initialCardUrl) setCardTarget({ url: tab?.url || null, revision: 0 });
    });
  }, []);

  useEffect(() => {
    const receiveUrl = (event) => {
      if (event.source !== window.parent || event.data?.source !== 'renaiss-index-companion') return;
      if (event.data.action === 'active-card-context') {
        setCardTarget((current) => ({ url: event.data.cardUrl || current.url, metadata: event.data.metadata || null, revision: current.revision + 1 }));
      } else if (event.data.action === 'refresh-active-card') {
        window.parent.postMessage({ source: 'renaiss-index-companion', action: 'get-active-card-context' }, '*');
      }
    };
    const receiveTabUrl = async (tabId, changeInfo) => {
      if (!changeInfo.url) return;
      const tab = await activeTab();
      if (tab?.id === tabId) setCardTarget((current) => ({ url: changeInfo.url, metadata: null, revision: current.revision + 1 }));
    };
    window.addEventListener('message', receiveUrl);
    chrome.tabs.onUpdated.addListener(receiveTabUrl);
    return () => {
      window.removeEventListener('message', receiveUrl);
      chrome.tabs.onUpdated.removeListener(receiveTabUrl);
    };
  }, []);

  useEffect(() => {
    window.parent.postMessage({ source: 'renaiss-index-companion', action: 'get-active-card-context' }, '*');
  }, []);

  useEffect(() => {
    if (!credentials?.renaissApiKey || !credentials?.renaissApiSecret) return;
    let alive = true;
    Promise.all([
      request('/indices/one-piece', credentials, setRateLimit),
      request('/indices/one-piece/series?window=365', credentials, setRateLimit),
      request('/indices/pokemon', credentials, setRateLimit),
      request('/indices/pokemon/series?window=365', credentials, setRateLimit)
    ]).then(([onePiece, onePieceSeries, pokemon, pokemonSeries]) => {
      if (alive) setIndices({ onePiece, onePieceSeries, pokemon, pokemonSeries });
    }).catch(() => alive && setIndices({ error: true }));
    return () => { alive = false; };
  }, [credentials?.renaissApiKey, credentials?.renaissApiSecret]);

  useEffect(() => {
    if (!credentials) return;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    const load = async () => {
      const tab = await activeTab();
      const context = cardContextForUrl(cardTarget.url, tab?.id);
      if (!context) {
        if (version === requestVersion.current) setCardState({ status: 'empty', card: null, fmv: null, trades: null, error: 'Open a Renaiss card page or search the Index.' });
        return;
      }
      if (!credentials.renaissApiKey || !credentials.renaissApiSecret) {
        if (version === requestVersion.current) setCardState({ status: 'empty', card: null, fmv: null, trades: null, error: 'Enter both Renaiss API credentials in API access below.' });
        return;
      }
      if (context.legacyItemId && cardTarget.metadata?.timedOut) {
        if (version === requestVersion.current) setCardState({ status: 'error', card: null, fmv: null, trades: null, error: 'Renaiss did not finish rendering this card. Close the modal and try again.' });
        return;
      }
      if (context.legacyItemId && cardTarget.metadata?.ready !== true) {
        if (version === requestVersion.current) setCardState({ status: 'loading', card: null, fmv: null, trades: null, error: '' });
        return;
      }
      setCardState({ status: 'loading', card: null, fmv: null, trades: null, error: '' });
      try {
        const card = await resolveCard(context, cardTarget.metadata, credentials, setRateLimit, controller.signal);
        const [fmv, trades] = await Promise.all([
          request(`/cards/by-id/${encodeURIComponent(card.id)}/fmv-series`, credentials, setRateLimit, { signal: controller.signal }),
          request(`/cards/by-id/${encodeURIComponent(card.id)}/trades`, credentials, setRateLimit, { signal: controller.signal })
        ]);
        if (version === requestVersion.current) setCardState({ status: 'ready', card, fmv, trades, error: '' });
      } catch (error) {
        if (error.name !== 'AbortError' && version === requestVersion.current) setCardState({ status: 'error', card: null, fmv: null, trades: null, error: error.message });
      }
    };
    load();
    return () => controller.abort();
  }, [cardTarget, credentials]);

  return <main className="app-shell">
    <Header card={cardState.card} />
    <IndexComparison indices={indices} />
    {cardState.status === 'loading' && <Loading />}
    {cardState.status === 'ready' && <CardDetails card={cardState.card} fmv={cardState.fmv} trades={cardState.trades} pageMetadata={cardTarget.metadata} />}
    {(cardState.status === 'empty' || cardState.status === 'error') && <SearchPanel credentials={credentials} onRateLimit={setRateLimit} onCardUrl={(url) => setCardTarget((current) => ({ url, metadata: null, revision: current.revision + 1 }))} message={cardState.error} />}
    <ApiSettings credentials={credentials} setCredentials={setCredentials} rateLimit={rateLimit} setRateLimit={setRateLimit} />
  </main>;
}

function Header({ card }) {
  return <header className="app-header"><div><p className="eyebrow">RENAISS OS</p><h1>Index Companion</h1></div><div className="header-actions">
    {card?.href && <a className="icon-link" target="_blank" rel="noreferrer" href={`${INDEX_BASE}${card.href}`} aria-label="Open card on Renaiss Index">↗</a>}
    <button className="close-button" type="button" onClick={() => window.parent.postMessage({ source: 'renaiss-index-companion', action: 'close-modal' }, '*')} aria-label="Close companion">×</button>
  </div></header>;
}

function IndexComparison({ indices }) {
  return <section className="index-section"><div className="section-heading index-heading"><div><p className="eyebrow">MARKET OVERVIEW</p><h2>Renaiss Index comparison</h2></div><span className="muted">Hover a line for daily value</span></div><div className="index-grid">
    <IndexCard title="One Piece" game="one-piece" detail={indices?.onePiece} series={indices?.onePieceSeries} error={indices?.error} />
    <IndexCard title="Pokémon" game="pokemon" detail={indices?.pokemon} series={indices?.pokemonSeries} error={indices?.error} />
  </div></section>;
}

function IndexCard({ title, game, detail, series, error }) {
  const [hover, setHover] = useState(null);
  const points = (series?.points || []).filter((point) => Number.isFinite(point.value) && point.t);
  const values = points.map((point) => point.value);
  const min = Math.min(...values); const range = Math.max(...values) - min || 1;
  const color = game === 'one-piece' ? '#72d6bb' : '#ffcb5c';
  const coordinates = points.map((point, index) => ({ x: points.length > 1 ? (index / (points.length - 1)) * 480 : 0, y: 150 - ((point.value - min) / range) * 150, point }));
  const path = coordinates.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const selected = hover === null ? null : coordinates[hover];
  return <article className="index-card"><div className="index-card-header"><span className={`index-dot ${game === 'one-piece' ? 'one-piece-dot' : 'pokemon-dot'}`}></span><strong>{title}</strong><span className="muted">{error ? 'Unavailable' : detail ? `${formatNumber(detail.constituentCount)} cards` : 'Loading…'}</span></div>
    <p className="index-value">{formatIndexValue(detail?.value)}</p><p className={`index-change ${detail?.deltas?.d365 >= 0 ? 'positive' : 'negative'}`}>{Number.isFinite(detail?.deltas?.d365) ? `${detail.deltas.d365 > 0 ? '+' : ''}${detail.deltas.d365.toFixed(1)}% · 1 year` : '—'}</p>
    {coordinates.length > 1 ? <div className="index-chart" onMouseLeave={() => setHover(null)} onMouseMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHover(Math.round(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * (coordinates.length - 1))); }}><svg viewBox="0 0 480 150" preserveAspectRatio="none" aria-hidden="true"><path d={`${path} L480,150 L0,150 Z`} fill={color} fillOpacity=".13"/><path d={path} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>{selected && <><line x1={selected.x} x2={selected.x} y1="0" y2="150" className="index-hover-line"/><circle cx={selected.x} cy={selected.y} r="4" fill={color} className="index-hover-dot"/></>}</svg>{selected && <span className="index-tooltip">{formatIndexDate(selected.point.t)} · {formatIndexValue(selected.point.value)}</span>}</div> : <div className="index-chart chart-empty">No index history available.</div>}
  </article>;
}

function Loading() { return <section className="state-card"><span className="spinner"/><p>Loading current card data…</p></section>; }

function CardDetails({ card, fmv, trades, pageMetadata }) {
  return <section><div className="identity-row">{card.imageUrl && <img className="card-image" src={card.imageUrl} alt={card.name}/>}<div><h2>{card.name}</h2><p className="muted">{[card.setName, card.cardNumber, card.variation, card.language].filter(Boolean).join(' · ')}</p></div></div>
    {(pageMetadata?.renaissItemId || pageMetadata?.serial) && <p className="page-card-context"><strong>Detected Renaiss card</strong>{pageMetadata.renaissItemId && <> · Item {shortId(pageMetadata.renaissItemId)}</>}{pageMetadata.serial && <> · Cert {pageMetadata.serial}</>}</p>}
    <section className="hero-price"><p className="eyebrow">{card.gradeLabel || [card.company, card.grade].filter(Boolean).join(' ')}</p><p className="price">{formatUsd(card.priceUsdCents)}</p><p className="confidence">{card.confidence ? `${card.confidence} confidence` : 'Price confidence unavailable'}</p></section>
    <section className="stat-grid">{[['7D', card.deltas?.d7], ['30D', card.deltas?.d30], ['1Y', card.deltas?.d365]].map(([label, value]) => <article key={label}><span>{label}</span><strong className={value >= 0 ? 'positive' : 'negative'}>{formatDelta(value)}</strong></article>)}</section>
    <FmvChart points={fmv?.points || []}/>
    <section className="stat-grid details-grid"><article><span>Sources</span><strong>{formatNumber(card.sourceCount)}</strong></article><article><span>Observations</span><strong>{formatNumber(card.observationCount)}</strong></article><article><span>Last observed</span><strong>{formatDate(card.lastSaleAt || card.updatedAt)}</strong></article></section>
    <p className="source-summary">{(card.sourceBreakdown || []).map((source) => `${source.displayName} (${formatNumber(source.count)})`).join(' · ')}</p>
    {(card.otherGrades || []).filter((grade) => grade.priceUsdCents != null).length > 0 && <section className="panel"><div className="section-heading"><h3>Other grades</h3></div><div className="grade-list">{card.otherGrades.filter((grade) => grade.priceUsdCents != null).slice(0, 6).map((grade, index) => <div className="grade-row" key={index}><span>{grade.gradeLabel || [grade.company, grade.grade].filter(Boolean).join(' ')}</span><strong>{formatUsd(grade.priceUsdCents)}</strong></div>)}</div></section>}
    <Trades trades={trades}/>
  </section>;
}

function FmvChart({ points }) { const valid = points.filter((point) => Number.isFinite(point.usdCents)); const values = valid.map((point) => point.usdCents); const min = Math.min(...values); const range = Math.max(...values) - min || 1; const path = valid.map((point, index) => `${index ? 'L' : 'M'}${(index / Math.max(1, valid.length - 1) * 360).toFixed(1)},${(92 - ((point.usdCents - min) / range) * 92).toFixed(1)}`).join(' '); return <section className="panel"><div className="section-heading"><h3>30-day FMV</h3><span className="muted">{valid.length ? `${valid.length} daily points` : 'No history'}</span></div>{valid.length > 1 ? <div className="chart"><svg viewBox="0 0 360 92" preserveAspectRatio="none"><path d={`${path} L360,92 L0,92 Z`} fill="#72d6bb" fillOpacity=".18"/><path d={path} fill="none" stroke="#72d6bb" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/></svg></div> : <div className="chart chart-empty">No FMV history available.</div>}</section>; }

function Trades({ trades }) { const items = (trades?.trades || []).filter((trade) => trade.priceUsdCents != null).slice(0, 5); return <section className="panel"><div className="section-heading"><h3>Recent market observations</h3><span className="muted">{Number.isFinite(trades?.total) ? `${formatNumber(trades.total)} total` : ''}</span></div><div className="trade-list">{items.length ? items.map((trade, index) => <div className="trade-row" key={index}><div><strong>{trade.displayName || trade.source}</strong><span>{[trade.kind, formatDate(trade.observedAt)].filter(Boolean).join(' · ')}</span></div><strong>{formatUsd(trade.priceUsdCents)}</strong></div>) : <p className="muted">No market observations available.</p>}</div></section>; }

function SearchPanel({ credentials, onRateLimit, onCardUrl, message }) { const [query, setQuery] = useState(''); const [results, setResults] = useState([]); const [error, setError] = useState(''); const search = async (event) => { event.preventDefault(); if (query.trim().length < 2) return; try { const data = await request(`/search?q=${encodeURIComponent(query.trim())}&limit=12`, credentials, onRateLimit); setResults(data.results || []); setError(''); } catch (err) { setError(err.message); } }; return <><section className="state-card"><p className="state-title">Find a Renaiss Index card</p><p className="muted">{message}</p></section><section><form className="search-form" onSubmit={search}><label>Find a card</label><div className="search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" minLength="2" placeholder="e.g. Monkey D. Luffy 014"/><button type="submit">Search</button></div></form>{error && <p className="muted">{error}</p>}<div className="search-results">{results.map((card) => <button className="search-result" type="button" key={card.id} onClick={() => onCardUrl(`${INDEX_BASE}${card.href}`)}><span><strong>{card.name}</strong><span>{[card.setName, card.cardNumber, card.gradeLabel].filter(Boolean).join(' · ')}</span></span></button>)}</div></section></>; }

function ApiSettings({ credentials, setCredentials, rateLimit, setRateLimit }) { const [key, setKey] = useState(''); const [secret, setSecret] = useState(''); useEffect(() => { setKey(credentials?.renaissApiKey || ''); setSecret(credentials?.renaissApiSecret || ''); }, [credentials]); const save = async () => { if (!key.trim() || !secret.trim()) return setRateLimit('Enter both the API key and secret.'); const next = { renaissApiKey: key.trim(), renaissApiSecret: secret.trim() }; await chrome.storage.session.set(next); setCredentials(next); setRateLimit('Saved for this browser session only.'); }; const clear = async () => { await chrome.storage.session.remove(CREDENTIAL_KEYS); setCredentials({ renaissApiKey: '', renaissApiSecret: '' }); setRateLimit('Credentials cleared.'); }; return <details className="settings"><summary>API access</summary><p className="muted">Authentication is required. Credentials are kept only for the current browser session and are never saved in the extension files.</p><label>API key</label><input value={key} onChange={(event) => setKey(event.target.value)} type="password" autoComplete="off" placeholder="rk_…"/><label>API secret</label><input value={secret} onChange={(event) => setSecret(event.target.value)} type="password" autoComplete="off" placeholder="rsk_…"/><div className="settings-actions"><button type="button" onClick={save}>Save</button><button type="button" className="secondary" onClick={clear}>Clear</button></div><p className="muted">{rateLimit}</p></details>; }

function formatUsd(cents) { return Number.isFinite(cents) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100) : '—'; }
function formatNumber(value) { return Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : '—'; }
function formatIndexValue(value) { return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) : '—'; }
function formatIndexDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date); }
function formatDate(value) { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date) : '—'; }
function formatDelta(value) { return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%` : '—'; }
function shortId(value) { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }

createRoot(document.getElementById('root')).render(<App />);
