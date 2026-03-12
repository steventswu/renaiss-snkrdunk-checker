// content.js
console.log("SNKRDUNK Price Checker: Content script loaded.");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCardTitle") {
    // Legacy support
    const titleText = findCardTitle();
    if (titleText) {
      sendResponse({ title: titleText });
    } else {
      sendResponse({ error: "Title not found" });
    }
  } else if (request.action === "getCardMetadata") {
    // New structured metadata upgrade
    const metadata = getCardMetadata();
    sendResponse(metadata);
  } else if (request.action === "toggleModal") {
    console.log("Toggle Modal message received!", request);
    toggleSNKRDUNKModal();
    sendResponse({ success: true });
  }
});

function findCardTitle() {
  const candidates = [
    'h1',
    'span.text-2xl.font-semibold.text-white',
    '.text-2xl.font-semibold',
    '[class*="text-2xl"][class*="font-bold"]',
    'header h1'
  ];

  for (const selector of candidates) {
    const elements = Array.from(document.querySelectorAll(selector));
    const visible = elements.find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
    });

    if (visible) {
      return visible.textContent.trim();
    }
  }
  return "";
}

/**
 * NEW: Structured Metadata Extraction
 */
function getCardMetadata() {
  const rawTitle = findCardTitle();
  const metadata = {
    rawTitle: rawTitle,
    name: "",
    set: "",
    number: "",
    year: "",
    language: "",
    grader: "",
    grade: "",
    serial: "",
    fmvPriceUSD: 0,
    cleanSerial: ""
  };

  // 1. Try to find the "Show More" details/badges in the DOM
  try {
    // Renaiss uses both div and span elements for badge containers
    const badges = Array.from(document.querySelectorAll(
      'div[class*="flex"][class*="items-center"][class*="gap-"], span[class*="flex"][class*="items-center"][class*="gap-"]'
    ));
    badges.forEach(b => {
      const text = b.textContent.toUpperCase();
      if (text.includes('GRADER')) metadata.grader = b.textContent.replace(/GRADER/i, '').trim();
      if (text.includes('SERIAL')) metadata.serial = b.textContent.replace(/SERIAL/i, '').trim();
      if (text.includes('GRADE')) metadata.grade = b.textContent.replace(/GRADE/i, '').trim();
    });
    // Also try searching all visible text for PSA serial pattern
    if (!metadata.serial) {
      const allText = document.body?.textContent || '';
      const psaSerialMatch = allText.match(/PSA\d{6,}/);
      if (psaSerialMatch) {
        metadata.serial = psaSerialMatch[0];
        console.log(`[META] Found serial from body text: ${metadata.serial}`);
      }
    }
  } catch (e) { }

  // 2. Try to extract from __NEXT_DATA__ (Next.js Hydration API)
  try {
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    if (nextDataEl) {
      const parsed = JSON.parse(nextDataEl.textContent);
      // Path usually looks like: props.pageProps.trpcState.json.queries[...].state.data.json
      const queries = parsed?.props?.pageProps?.trpcState?.json?.queries || [];
      const cardQuery = queries.find(q => q.queryKey?.[0]?.includes('collectible.list') || q.queryKey?.[0]?.includes('item'));

      if (cardQuery && cardQuery.state?.data?.json) {
        const item = cardQuery.state.data.json;
        if (Array.isArray(item)) {
          // It's a list response
          const card = item[0];
          if (card) {
            metadata.name = card.name || metadata.name;
            metadata.set = card.setName || card.set || metadata.set;
            metadata.number = card.cardNumber || card.number || metadata.number;
            metadata.year = card.year || metadata.year;
            metadata.language = card.language || metadata.language;
            metadata.grader = card.grader || metadata.grader;
            metadata.grade = card.grade || metadata.grade;
            metadata.serial = card.serialNumber || metadata.serial;
            // Extract FMV price (stored in cents, convert to dollars)
            if (card.fmvPriceInUSD) {
              metadata.fmvPriceUSD = parseFloat(card.fmvPriceInUSD) / 100;
            } else if (card.fmvPrice) {
              metadata.fmvPriceUSD = parseFloat(card.fmvPrice) / 100;
            }
          }
        }
      }
    }
  } catch (e) {
    console.log("Error parsing __NEXT_DATA__:", e);
  }

  // 2b. Try RSC streaming data (__next_f chunks) for FMV price
  if (!metadata.fmvPriceUSD) {
    try {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        const text = script.textContent || '';
        // Look for fmvPriceInUSD in streaming data chunks
        // Value can be bare number OR quoted string: "fmvPriceInUSD":69200 or "fmvPriceInUSD":"69200"
        const fmvMatch = text.match(/"fmvPriceInUSD"\s*[:\s,]*"?(\d+)"?/);
        if (fmvMatch) {
          metadata.fmvPriceUSD = parseInt(fmvMatch[1], 10) / 100;
          console.log(`[META] Found FMV in RSC data: $${metadata.fmvPriceUSD} (raw: ${fmvMatch[1]})`);
          break;
        }
      }
    } catch (e) { }
  }

  // 2c. Fallback: Try to find FMV from visible DOM text (e.g. "FMV $ 692")
  if (!metadata.fmvPriceUSD) {
    try {
      const bodyText = document.body?.textContent || '';
      const fmvDomMatch = bodyText.match(/FMV\s*\$\s*([\d,.]+)/);
      if (fmvDomMatch) {
        metadata.fmvPriceUSD = parseFloat(fmvDomMatch[1].replace(/,/g, ''));
        console.log(`[META] Found FMV in DOM text: $${metadata.fmvPriceUSD}`);
      }
    } catch (e) { }
  }

  console.log(`[META] Final FMV: $${metadata.fmvPriceUSD}, Serial: ${metadata.serial}, CleanSerial: ${metadata.cleanSerial}`);

  // 3. Fallback: Parse the title if metadata still empty
  if (!metadata.name && rawTitle) {
    // Title structure: [GRADER] [GRADE_WORDS] [YEAR] [TCG] [LANG] [SET_NAME] #[NUMBER] [CARD_NAME]
    // Example: "PSA 10 Gem Mint 2022 Pokemon Japanese Sword & Shield Vstar Universe #183 Mew"

    const yearMatch = rawTitle.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) metadata.year = yearMatch[0];

    const numMatch = rawTitle.match(/#(\d+[\/\-]?\d*)/);
    if (numMatch) metadata.number = numMatch[1];

    const langMatch = rawTitle.match(/\b(Japanese|English|Korean|Chinese)\b/i);
    if (langMatch) metadata.language = langMatch[0];

    const graderMatch = rawTitle.match(/\b(PSA|BGS|CGC)\b/i);
    if (graderMatch) metadata.grader = graderMatch[0];

    // Extract CARD NAME: everything after "#NUMBER "
    if (numMatch) {
      const hashPos = rawTitle.indexOf('#' + numMatch[1]);
      const afterNumber = rawTitle.substring(hashPos + numMatch[1].length + 1).trim();
      if (afterNumber) {
        metadata.name = afterNumber;
      }
    }

    // Extract SET NAME: text between language/Pokemon and #NUMBER
    if (numMatch) {
      const hashPos = rawTitle.indexOf('#' + numMatch[1]);
      const beforeNumber = rawTitle.substring(0, hashPos).trim();
      let setCandidate = beforeNumber
        .replace(/\b(PSA|BGS|CGC)\s*\d+\s*(Gem\s*Mint|Mint|Near\s*Mint|Excellent)?/gi, '')
        .replace(/\b(19|20)\d{2}\b/g, '')
        .replace(/\b(Pokemon|One Piece)\b/gi, '')
        .replace(/\b(Japanese|English|Korean|Chinese)\b/gi, '')
        .replace(/\s+/g, ' ').trim();
      if (setCandidate && setCandidate.length > 1) {
        metadata.set = setCandidate;
      }
    }
  }

  // Extract clean serial number (numeric only, e.g. "PSA78559837" → "78559837")
  if (metadata.serial) {
    const serialDigits = metadata.serial.replace(/[^0-9]/g, '');
    if (serialDigits.length >= 6) {
      metadata.cleanSerial = serialDigits;
    }
  }

  console.log("Extracted Card Metadata:", metadata);
  return metadata;
}

function toggleSNKRDUNKModal() {
  let container = document.getElementById('snkrdunk-checker-container');
  if (container) {
    container.remove();
    return;
  }

  container = document.createElement('div');
  container.id = 'snkrdunk-checker-container';
  container.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(2, 6, 23, 0.4);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex; justify-content: center; align-items: center;
        z-index: 999999999;
        animation: snkrdunkFadeIn 0.3s ease-out;
    `;

  // Inject animations
  if (!document.getElementById('snkrdunk-animations')) {
    const style = document.createElement('style');
    style.id = 'snkrdunk-animations';
    style.textContent = `
            @keyframes snkrdunkFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes snkrdunkSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        `;
    document.head.appendChild(style);
  }

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('popup.html');
  iframe.style.cssText = `
        width: 600px;
        height: 850px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 28px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
        background: transparent;
        animation: snkrdunkSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    `;

  container.appendChild(iframe);
  document.body.appendChild(container);

  container.onclick = (e) => {
    if (e.target === container) container.remove();
  };
}

// Global listener for close message from iframe
window.addEventListener('message', (event) => {
  if (event.data === 'closeSnkrdunkModal') {
    const container = document.getElementById('snkrdunk-checker-container');
    if (container) {
      console.log("Closing modal via message");
      container.remove();
    }
  }
});
