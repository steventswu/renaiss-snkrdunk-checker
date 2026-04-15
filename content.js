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
    'span.mt-1.text-xl.text-white.tracking-\\[0\\.4px\\]',
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
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
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

  // 0. Visual Identification: Check image URLs for Certification Numbers
  extractMetadataFromImages(metadata);

  // 1. New Layout: Scrape from the "Card Details" grid
  try {
    const gridCols = Array.from(document.querySelectorAll('div.grid.grid-cols-\\[auto_1fr\\].gap-x-3.gap-y-1'));
    if (gridCols.length > 0) {
      gridCols.forEach(grid => {
        const rows = Array.from(grid.children);
        for (let i = 0; i < rows.length; i += 2) {
          const label = rows[i]?.textContent?.trim()?.toUpperCase();
          const value = rows[i + 1]?.textContent?.trim();
          if (!label || !value) continue;

          if (label === 'GRADER') metadata.grader = value;
          if (label === 'GRADE') metadata.grade = value;
          if (label === 'SERIAL') metadata.serial = value;
          if (label === 'SET') metadata.set = value;
        }
      });
    }

    // Fallback: Legacy/Badge structure
    if (!metadata.grader || !metadata.serial) {
      const badges = Array.from(document.querySelectorAll(
        'div[class*="flex"][class*="items-center"][class*="gap-"], span[class*="flex"][class*="items-center"][class*="gap-"]'
      ));
      badges.forEach(b => {
        const text = b.textContent.toUpperCase();
        if (text.includes('GRADER')) metadata.grader = b.textContent.replace(/GRADER/i, '').trim();
        if (text.includes('SERIAL')) metadata.serial = b.textContent.replace(/SERIAL/i, '').trim();
        if (text.includes('GRADE')) metadata.grade = b.textContent.replace(/GRADE/i, '').trim();
      });
    }

    // Also try searching all visible text for PSA serial pattern if still missing
    if (!metadata.serial) {
      const allText = document.body?.textContent || '';
      const psaSerialMatch = allText.match(/PSA\s*(\d{8,})/i) || allText.match(/\b(\d{8,})\b/);
      if (psaSerialMatch) {
        metadata.serial = psaSerialMatch[1] || psaSerialMatch[0];
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
        const fmvMatch = text.match(/"fmvPriceInUSD"\s*[:\s,]*"?(\d+)"?/) || text.match(/\\?"fmvPriceInUSD\\?"\s*[:\s,]*\\?"?(\d+)\\?"?/);
        if (fmvMatch) {
          metadata.fmvPriceUSD = parseInt(fmvMatch[1], 10) / 100;
          console.log(`[META] Found FMV in RSC data: $${metadata.fmvPriceUSD} (raw: ${fmvMatch[1]})`);
          break;
        }
      }
    } catch (e) { }
  }

  // 2c. New Layout: Try to find FMV from the "FMV" badge (often yellow/gold)
  if (!metadata.fmvPriceUSD) {
    try {
      const fmvBadge = document.querySelector('div.bg-\\[\\#fdc600\\]\\/20, div.bg-yellow-400\\/20');
      if (fmvBadge) {
        const fmvText = fmvBadge.textContent.replace(/[^0-9.]/g, '');
        if (fmvText) {
          metadata.fmvPriceUSD = parseFloat(fmvText);
          console.log(`[META] Found FMV in Badge: $${metadata.fmvPriceUSD}`);
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
    // New Renaiss layout title example: "#020 Pikachu"

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
    } else {
      metadata.name = rawTitle;
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

  // 4. PRE-PROCESSING & CLEANING
  // If year/language still missing, try to extract from Set field
  if (!metadata.year && metadata.set) {
    const yrMatch = metadata.set.match(/\b(19|20)\d{2}\b/);
    if (yrMatch) {
      metadata.year = yrMatch[0];
      metadata.set = metadata.set.replace(yrMatch[0], '').trim();
    }
  }
  if (!metadata.language && metadata.set) {
    const lgMatch = metadata.set.match(/\b(Japanese|English|Korean|Chinese)\b/i);
    if (lgMatch) {
      metadata.language = lgMatch[0];
      metadata.set = metadata.set.replace(new RegExp(lgMatch[0], 'i'), '').trim();
    }
  }

  // Clean Name: Strip leading number if redundant
  if (metadata.name && metadata.number) {
    const cleanName = metadata.name.replace(new RegExp(`^#?${metadata.number}\\s*`, 'i'), '').trim();
    if (cleanName) metadata.name = cleanName;
  }

  // Clean Set: Remove noise keywords for SNKRDUNK/PriceCharting
  if (metadata.set) {
    metadata.set = metadata.set
      .replace(/\b(Pokemon|One Piece|TCG|Trading\s*Card\s*Game)\s*/gi, '')
      .replace(/\s+/g, ' ').trim();
  }

  // Extract clean serial number (numeric only, e.g. "PSA78559837" → "78559837")
  if (metadata.serial) {
    const serialDigits = metadata.serial.replace(/[^0-9]/g, '');
    if (serialDigits.length >= 6) {
      metadata.cleanSerial = serialDigits;
    }
  }

  console.log("Extracted Card Metadata:", metadata);
  
  // Inject the "Identify from Photo" button if it's a graded card
  if (metadata.grader || metadata.serial || metadata.rawTitle.match(/\b(PSA|BGS|CGC)\b/i)) {
    injectIdentificationUI(metadata);
  }

  return metadata;
}

/**
 * PHOTO IDENTIFICATION: Extracts cert numbers from image URLs
 */
function extractMetadataFromImages(metadata) {
  try {
    const images = Array.from(document.querySelectorAll('img[src]'));
    for (const img of images) {
      const src = img.getAttribute('src') || '';
      // Look for PSA/BGS/CGC prefixes followed by 8+ digits in the URL
      const certMatch = src.match(/\/(PSA|BGS|CGC)(\d{7,10})\//i) || src.match(/_(PSA|BGS|CGC)(\d{7,10})\./i);
      if (certMatch) {
        const grader = certMatch[1].toUpperCase();
        const serial = certMatch[2];
        
        if (!metadata.grader) metadata.grader = grader;
        if (!metadata.serial) metadata.serial = serial;
        
        console.log(`[PHOTO-ID] Found ${grader} Cert in URL: ${serial}`);
        break;
      }
    }
  } catch (e) {
    console.error("[PHOTO-ID] Error extracting from images:", e);
  }
}

/**
 * UI: Injects the "Identify from Photo" button
 */
function injectIdentificationUI(metadata) {
  // Avoid duplicate injection
  if (document.getElementById('renaiss-photo-id-btn')) return;

  // Find a suitable place to inject (near the FMV badge)
  const anchor = document.querySelector('div.bg-\\[\\#fdc600\\]\\/20, div.bg-yellow-400\\/20')?.parentElement;
  if (!anchor) return;

  const btn = document.createElement('button');
  btn.id = 'renaiss-photo-id-btn';
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
    Identify from Photo
  `;
  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    margin-left: 12px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: #94a3b8;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  `;

  btn.onmouseover = () => { btn.style.background = 'rgba(255, 255, 255, 0.1)'; btn.style.color = '#fff'; };
  btn.onmouseout = () => { btn.style.background = 'rgba(255, 255, 255, 0.05)'; btn.style.color = '#94a3b8'; };

  btn.onclick = async () => {
    btn.innerHTML = 'Reading Label...';
    btn.disabled = true;
    try {
      const result = await performOCRIdentification();
      if (result) {
        console.log("[PHOTO-ID] OCR Result:", result);
        // Refresh metadata with new findings
        const updatedMetadata = getCardMetadata();
        // Since we can't easily "push" update to popup, we alert or rely on next popup open
        btn.innerHTML = '✅ Identification Complete';
        btn.style.borderColor = '#10b981';
        btn.style.color = '#10b981';
      } else {
        btn.innerHTML = '❌ No slab detected';
      }
    } catch (err) {
      console.error("[PHOTO-ID] Error:", err);
      btn.innerHTML = '⚠️ OCR Failed';
    }
  };

  anchor.appendChild(btn);
}

/**
 * CORE: Performs OCR via Tesseract.js
 */
async function performOCRIdentification() {
  // Find highest res image
  const img = document.querySelector('img[class*="object-contain"]');
  if (!img) return null;

  try {
    // Initialize Tesseract (it should be globally available from manifest)
    // We use a worker for better performance
    const worker = await Tesseract.createWorker('eng');
    const { data: { text } } = await worker.recognize(img.src);
    await worker.terminate();

    console.log("[PHOTO-ID] Raw OCR Text:", text);

    // Parse the text for key indicators
    const findings = {
      mcdonalds: text.match(/McDONALD/i),
      masterball: text.match(/Master\s*Ball/i),
      promo: text.match(/Promo/i),
      serial: text.match(/\b(\d{7,10})\b/)
    };

    // If we found something relevant not in the original metadata, we can store it in sessionStorage
    // or broadcast it. For now, we'll log it.
    return text;
  } catch (e) {
    throw e;
  }
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
