// Injected directly by the extension action on every click. Keeping this in a
// self-contained IIFE means an already-open SPA page cannot retain an older
// content-script implementation or a previous card's modal state.
(() => {
  const host = globalThis.__renaissIndexModalHost || (globalThis.__renaissIndexModalHost = {});

  const getMetadata = () => {
    const renaissItemId = location.pathname.match(/^\/card\/([^/]+)\/?$/)?.[1] || '';
    const tokenLink = Array.from(document.querySelectorAll('a[href*="/nft/"]')).find((link) => {
      try {
        return new URL(link.href).pathname.split('/').pop() === renaissItemId;
      } catch (error) {
        return false;
      }
    });
    const renderedItemId = tokenLink ? new URL(tokenLink.href).pathname.split('/').pop() : '';
    const ready = !renaissItemId || renderedItemId === renaissItemId;
    const details = {};
    if (ready) document.querySelectorAll('div.grid.grid-cols-\\[auto_1fr\\].gap-x-3.gap-y-1').forEach((grid) => {
      const children = Array.from(grid.children);
      for (let index = 0; index + 1 < children.length; index += 2) {
        const label = children[index].textContent.trim().toLowerCase();
        if (label) details[label] = children[index + 1].textContent.trim();
      }
    });
    const image = ready && Array.from(document.querySelector('main')?.images || []).find((candidate) => {
      const source = candidate.currentSrc || candidate.src || '';
      return candidate.getClientRects().length > 0 && (source.includes('graded-cards-renders') || /card|slab/i.test(candidate.alt || ''));
    });
    return {
      ready,
      title: document.querySelector('h1')?.textContent?.trim() || document.title,
      renaissItemId,
      renderedItemId,
      imageUrl: image?.currentSrc || image?.src || '',
      serial: details.serial || '',
      grader: details.grader || '',
      grade: details.grade || '',
      setName: details.set || '',
      cardNumber: details['card number'] || '',
      language: details.language || ''
    };
  };

  const waitForCurrentMetadata = async () => {
    const deadline = Date.now() + 10000;
    let metadata = getMetadata();
    while (!metadata.ready && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      metadata = getMetadata();
    }
    return { ...metadata, timedOut: !metadata.ready };
  };

  const close = () => {
    const overlay = document.getElementById('renaiss-index-companion-modal');
    overlay?.remove();
  };

  if (host.messageListener) window.removeEventListener('message', host.messageListener);
  host.messageListener = async (event) => {
    const frame = document.getElementById('renaiss-index-companion-frame');
    if (event.source !== frame?.contentWindow || event.data?.source !== 'renaiss-index-companion') return;
    if (event.data.action === 'close-modal') close();
    if (event.data.action === 'get-active-card-context') {
      const metadata = await waitForCurrentMetadata();
      const currentFrame = document.getElementById('renaiss-index-companion-frame');
      if (currentFrame !== frame) return;
      frame.contentWindow.postMessage({
        source: 'renaiss-index-companion',
        action: 'active-card-context',
        cardUrl: location.href,
        metadata
      }, '*');
    }
  };
  window.addEventListener('message', host.messageListener);

  // Replacing instead of hiding is intentional: every open receives a new
  // React tree, a new card request, and the current SPA URL.
  close();
  const overlay = document.createElement('div');
  overlay.id = 'renaiss-index-companion-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Renaiss Index card data');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'display:grid',
    'place-items:center', 'padding:24px', 'background:rgba(2,6,23,.72)',
    'backdrop-filter:blur(10px)', '-webkit-backdrop-filter:blur(10px)'
  ].join(';');
  const frame = document.createElement('iframe');
  frame.id = 'renaiss-index-companion-frame';
  frame.src = `${chrome.runtime.getURL('popup.html')}?cardUrl=${encodeURIComponent(location.href)}`;
  frame.title = 'Renaiss Index Companion';
  frame.style.cssText = [
    'width:min(1080px,100%)', 'height:min(900px,calc(100vh - 36px))',
    'border:1px solid rgba(148,163,184,.28)', 'border-radius:20px',
    'box-shadow:0 32px 80px rgba(0,0,0,.55)', 'background:#09101d'
  ].join(';');
  overlay.append(frame);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.body.append(overlay);
})();
