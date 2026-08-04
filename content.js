// Read-only bridge for legacy renaiss.xyz card pages. No credentials or
// network requests are handled in the page context.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'getCardMetadata') return;
  sendResponse(getCardMetadata());
});

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
