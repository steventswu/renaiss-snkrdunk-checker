// Read-only bridge and modal host for Renaiss card pages. Credentials and API
// requests remain inside the extension iframe, never in the page context.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCardMetadata') {
    sendResponse(getCardMetadata());
  } else if (request.action === 'toggleModal') {
    toggleModal();
    sendResponse({ open: Boolean(document.getElementById('renaiss-index-companion-modal')) });
  }
});

let lastFocusedElement = null;
let lastCardUrl = location.href;
let cardChangeTimer = null;
let cardUrlWatcher = null;

function toggleModal() {
  const existing = document.getElementById('renaiss-index-companion-modal');
  if (existing) {
    if (existing.dataset.open === 'true') {
      closeModal();
    } else {
      lastFocusedElement = document.activeElement;
      openModal(existing);
    }
    return;
  }

  lastFocusedElement = document.activeElement;
  const overlay = document.createElement('div');
  overlay.id = 'renaiss-index-companion-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Renaiss Index card data');
  overlay.dataset.open = 'true';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'display:grid', 'place-items:center', 'padding:24px',
    'background:rgba(2, 6, 23, .72)', 'backdrop-filter:blur(10px)',
    '-webkit-backdrop-filter:blur(10px)', 'animation:renaissOverlayIn .18s ease-out'
  ].join(';');

  const frame = document.createElement('iframe');
  frame.id = 'renaiss-index-companion-frame';
  frame.src = chrome.runtime.getURL('popup.html');
  frame.title = 'Renaiss Index Companion';
  frame.style.cssText = [
    'width:min(1080px, 100%)', 'height:min(900px, calc(100vh - 36px))',
    'border:1px solid rgba(148, 163, 184, .28)', 'border-radius:20px',
    'box-shadow:0 32px 80px rgba(0, 0, 0, .55)', 'background:#09101d',
    'animation:renaissModalIn .22s cubic-bezier(.16, 1, .3, 1)'
  ].join(';');
  overlay.append(frame);
  document.body.append(overlay);
  startCardUrlWatcher();

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  document.addEventListener('keydown', onModalKeydown);
  installModalStyles();
}

function openModal(overlay) {
  overlay.style.display = 'grid';
  overlay.dataset.open = 'true';
  overlay.removeAttribute('aria-hidden');
  document.addEventListener('keydown', onModalKeydown);
  const frame = document.getElementById('renaiss-index-companion-frame');
  frame?.focus();
  frame?.contentWindow?.postMessage({ source: 'renaiss-index-companion', action: 'refresh-active-card' }, '*');
}

function closeModal() {
  const overlay = document.getElementById('renaiss-index-companion-modal');
  if (!overlay) return;
  document.removeEventListener('keydown', onModalKeydown);
  overlay.style.display = 'none';
  overlay.dataset.open = 'false';
  overlay.setAttribute('aria-hidden', 'true');
  lastFocusedElement?.focus?.();
}

function onModalKeydown(event) {
  if (event.key === 'Escape') closeModal();
}

function installModalStyles() {
  if (document.getElementById('renaiss-index-companion-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'renaiss-index-companion-modal-styles';
  style.textContent = '@keyframes renaissOverlayIn{from{opacity:0}to{opacity:1}}@keyframes renaissModalIn{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}';
  document.head.append(style);
}

window.addEventListener('message', (event) => {
  const frame = document.getElementById('renaiss-index-companion-frame');
  if (event.source !== frame?.contentWindow) return;
  if (event.data?.source === 'renaiss-index-companion' && event.data?.action === 'close-modal') closeModal();
});

function notifyCardChange() {
  if (location.href === lastCardUrl) return;
  lastCardUrl = location.href;
  clearTimeout(cardChangeTimer);
  cardChangeTimer = setTimeout(() => {
    document.getElementById('renaiss-index-companion-frame')?.contentWindow?.postMessage({
      source: 'renaiss-index-companion',
      action: 'refresh-active-card'
    }, '*');
  }, 250);
}

for (const method of ['pushState', 'replaceState']) {
  const original = history[method];
  history[method] = function (...args) {
    const result = original.apply(this, args);
    notifyCardChange();
    return result;
  };
}
window.addEventListener('popstate', notifyCardChange);

// Renaiss uses client-side navigation. Page scripts do not reliably trigger
// history hooks installed by an extension content script, so also observe the
// address directly while the companion is present.
function startCardUrlWatcher() {
  if (cardUrlWatcher) return;
  cardUrlWatcher = window.setInterval(notifyCardChange, 400);
}

function getCardMetadata() {
  const title = document.querySelector('h1')?.textContent?.trim() || document.title;
  const details = {};
  document.querySelectorAll('div.grid.grid-cols-\\[auto_1fr\\].gap-x-3.gap-y-1').forEach((grid) => {
    const children = Array.from(grid.children);
    for (let index = 0; index + 1 < children.length; index += 2) {
      const label = children[index].textContent.trim().toLowerCase();
      const value = children[index + 1].textContent.trim();
      if (label) details[label] = value;
    }
  });

  const image = Array.from(document.images).find((candidate) => {
    const source = candidate.currentSrc || candidate.src || '';
    return source.includes('graded-cards-renders') || /card|slab/i.test(candidate.alt || '');
  });

  return {
    title,
    imageUrl: unwrapNextImageUrl(image?.currentSrc || image?.src || ''),
    name: details.name || '',
    setName: details.set || '',
    cardNumber: details['card number'] || details.cardnumber || '',
    grader: details.grader || '',
    grade: details.grade || '',
    serial: details.serial || '',
    language: details.language || ''
  };
}

function unwrapNextImageUrl(source) {
  if (!source) return '';
  try {
    const url = new URL(source, location.href);
    return url.searchParams.get('url') || url.href;
  } catch (error) {
    return source;
  }
}
