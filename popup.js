// popup.js
document.addEventListener('DOMContentLoaded', async () => {
    const cardNameEl = document.getElementById('cardName');
    const psa10PriceEl = document.getElementById('psa10-price');
    const avgPriceEl = document.getElementById('avg-price');
    const psa10StatusEl = document.getElementById('psa10-status');
    const viewBtn = document.getElementById('viewOnSnkrdunk');
    const historyListEl = document.getElementById('trade-history-list');
    const totalUnitsSoldEl = document.getElementById('total-units-sold');
    const psa10PopEl = document.getElementById('psa10-pop');
    const totalGradedPopEl = document.getElementById('total-graded-pop');
    const closeBtn = document.getElementById('closeModal');

    if (closeBtn) {
        closeBtn.onclick = () => {
            console.log('Close button clicked');
            window.parent.postMessage('closeSnkrdunkModal', '*');
        };
    }

    // Shared price parsing utility
    function parsePrice(val) {
        if (!val) return 0;
        const num = parseFloat(val.toString().replace(/[^0-9.]/g, ''));
        return isNaN(num) ? 0 : num;
    }

    // Session-cached exchange rate (fetched once)
    let _cachedJpyRate = null;
    async function getExchangeRate() {
        if (_cachedJpyRate !== null) return _cachedJpyRate;
        try {
            const resp = await fetch('https://open.er-api.com/v6/latest/USD');
            const data = await resp.json();
            _cachedJpyRate = data.rates?.JPY || 150.0;
            console.log(`[FX] Live rate fetched: 1 USD = ¥${_cachedJpyRate}`);
        } catch (e) {
            console.warn('[FX] Failed to fetch live rate, using fallback', e);
            _cachedJpyRate = 150.0;
        }
        return _cachedJpyRate;
    }

    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab || !tab.url || !tab.url.includes("renaiss.xyz")) {
            cardNameEl.textContent = "Navigate to Renaiss.xyz";
            return;
        }
        const response = await chrome.tabs.sendMessage(tab.id, { action: "getCardMetadata" });
        if (response && (response.rawTitle || response.name)) {
            cardNameEl.textContent = response.name || response.rawTitle;
            // Pre-fetch exchange rate (non-blocking)
            getExchangeRate();
            // Run SNKRDUNK and PriceCharting searches in parallel
            const identity = refineSearchQuery(response);
            searchSnkrdunk(response);
            fetchPriceChartingData(identity);
        } else {
            cardNameEl.textContent = "Card not found";
        }
    } catch (error) {
        console.error("Popup Init Error:", error);
    }

    function refineSearchQuery(metadata) {
        if (metadata.name && metadata.number) {
            const cleanName = metadata.name.replace(/Lv\.X/g, '').trim();
            const setMarker = metadata.set || "";
            const year = metadata.year || "";
            const lang = metadata.language || "Japanese";

            // Set code mapping for better SNKRDUNK matching
            let setCode = setMarker;
            if (setMarker.includes("Universe")) setCode = "s12a";
            if (setMarker.includes("151")) setCode = "sv2a";

            // TCG detection: One Piece cards don't need "Pokemon" keyword
            const rawTitle = (metadata.rawTitle || "").toUpperCase();
            const isOnePiece = rawTitle.includes("ONE PIECE") || setMarker.toUpperCase().includes("ONE PIECE") ||
                /^(OP|ST)\d{2}/.test(setMarker.toUpperCase());
            const tcgKeyword = isOnePiece ? "" : "Pokemon";

            // Pad number to 3 digits (SNKRDUNK standard)
            const idRaw = metadata.number.replace('#', '').trim();
            const digitsOnly = idRaw.replace(/[^0-9]/g, '');
            const paddedNumber = digitsOnly.padStart(3, '0');

            return {
                idRaw,
                paddedNumber,
                fullId: metadata.number,
                subject: cleanName,
                setMarker: setCode.toUpperCase(),
                year,
                language: lang,
                isOnePiece,
                tcgKeyword,
                fmvPriceUSD: metadata.fmvPriceUSD || 0,
                cleanSerial: metadata.cleanSerial || '',
                variantKeywords: [],  // populated later by PSA cert lookup
                smartQuery: `${tcgKeyword} ${cleanName} ${idRaw} ${setCode}`.replace(/\s+/g, ' ').trim(),
                preciseQuery: `${setCode} ${idRaw}`.trim(),
                leanQuery: `${cleanName} ${idRaw}`.trim(),
                setQuery: `${setCode} ${idRaw}`.trim()
            };
        }

        // Fallback parsing for incomplete metadata
        const title = metadata.rawTitle || "";
        let cleaned = title.replace(/\b(PSA|PSA10|Gem|Mint|Near|NearMint|Excellent|Grader|Authentic|CGC|BGS|10|9|8)\b/gi, '');
        cleaned = cleaned.replace(/\b(Trading\s*Card\s*Game|TCG|Card\s*Pack|Edition|Deck)\b/gi, '');

        const yearMatch = title.match(/\b(20\d{2}|19\d{2})\b/);
        const year = yearMatch ? yearMatch[0] : "";
        const langMatch = title.match(/\b(Japanese|English)\b/i);
        const language = langMatch ? langMatch[0] : "Japanese";
        const idMatch = title.match(/(#?\d+[\/\-]\d+|#\d+)/);
        const fullId = idMatch ? idMatch[0] : "";
        const idRaw = fullId.replace('#', '').trim();
        const paddedNumber = idRaw.replace(/[^0-9]/g, '').padStart(3, '0');

        const setCodeMatch = title.match(/\b([A-Z]{1,4}(?:\d+)?(?:\-[A-Z]+)?)\b/g) || [];
        const setMarker = setCodeMatch.find(m => !['PSA', 'TCG', 'GEM', 'CGC', 'BGS', 'USA', '2023'].includes(m.toUpperCase())) || "";

        let subject = cleaned.replace(year, '').replace(language, '').replace(fullId, '').replace(/\s+/g, ' ').trim();
        const words = subject.split(/\s+/).filter(w => w.length > 2);
        const leanSubject = words[0] || "";

        return {
            idRaw,
            paddedNumber,
            fullId,
            subject,
            setMarker: setMarker.toUpperCase(),
            year,
            language,
            fmvPriceUSD: metadata.fmvPriceUSD || 0,
            cleanSerial: metadata.cleanSerial || '',
            variantKeywords: [],
            smartQuery: `${year} Pokemon ${language} ${fullId} ${leanSubject}`.replace(/\s+/g, ' ').trim(),
            leanQuery: `${leanSubject} ${idRaw}`.trim(),
            setQuery: `${setMarker} ${idRaw}`.trim()
        };
    }

    // ==================== PSA CERT VARIANT LOOKUP ====================
    // PSA label terms → SNKRDUNK product name terms
    const VARIANT_MAPPING = {
        'MASTER BALL': 'MASTER BALL',
        'MONSTER BALL': 'MONSTER BALL',
        'REVERSE HOLO': 'MIRROR',       // PSA "REVERSE HOLO" = SNKRDUNK "Mirror" for JP cards
        'HOLO RARE': 'HOLO',
        '1ST EDITION': '1ST EDITION',
        'FULL ART': 'FULL ART',
        'ALT ART': 'ALT ART',
    };

    async function fetchPSACertLabel(serial) {
        if (!serial) return [];
        console.log(`[PSA CERT] Looking up cert #${serial}`);
        
        async function extractFromText(text) {
            if (!text) return [];
            const upper = text.toUpperCase();
            const found = [];
            for (const [psaTerm, snkrTerm] of Object.entries(VARIANT_MAPPING)) {
                if (upper.includes(psaTerm)) {
                    found.push(snkrTerm);
                }
            }
            return found;
        }

        try {
            // 1. Try DIRECT fetch (often blocked by Cloudflare)
            const resp = await fetch(`https://www.psacard.com/cert/${serial}`, {
                signal: AbortSignal.timeout(5000)
            });
            
            if (resp.ok) {
                const html = await resp.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const bodyText = doc.body ? doc.body.textContent : '';
                const keywords = await extractFromText(bodyText);
                if (keywords.length > 0) {
                    console.log(`[PSA CERT] Found direct keywords: ${keywords.join(', ')}`);
                    return keywords;
                }
            } else {
                console.log(`[PSA CERT] Direct lookup failed (HTTP ${resp.status}), trying Jina AI bypass...`);
            }

            // 2. Try JINA AI bypass (can often bypass Cloudflare)
            const jinaUrl = `https://r.jina.ai/https://www.psacard.com/cert/${serial}`;
            const jinaResp = await fetch(jinaUrl, {
                signal: AbortSignal.timeout(8000)
            });

            if (jinaResp.ok) {
                const jinaText = await jinaResp.text();
                const keywords = await extractFromText(jinaText);
                if (keywords.length > 0) {
                    console.log(`[PSA CERT] Found keywords via Jina: ${keywords.join(', ')}`);
                    return keywords;
                }
            }

            console.log('[PSA CERT] No variant keywords found via direct or Jina lookup');
            return [];
        } catch (e) {
            console.log(`[PSA CERT] Error during lookup:`, e.message || e);
            return [];
        }
    }

    async function searchSnkrdunk(metadata) {
        const identity = refineSearchQuery(metadata);
        resetUI();

        // Attempt to enrich identity with PSA cert variant keywords (non-blocking with timeout)
        if (identity.cleanSerial) {
            try {
                identity.variantKeywords = await fetchPSACertLabel(identity.cleanSerial);
            } catch (e) {
                console.log('[PSA CERT] Enrichment failed, continuing without variant data');
            }
        }
        console.log(`[SEARCH] Variant keywords: [${identity.variantKeywords.join(', ')}], FMV: $${identity.fmvPriceUSD}`);

        async function fetchProducts(query) {
            if (!query || query.length < 2) return [];
            const url = `https://snkrdunk.com/en/v1/search?keyword=${encodeURIComponent(query)}&perPage=40&page=1`;
            try {
                const resp = await fetch(url);
                if (!resp.ok) return [];
                const data = await resp.json();
                return (data.products || []).concat(data.streetwears || []).filter(p => p.isTradingCard);
            } catch (e) { return []; }
        }

        function scoreProduct(p, ident) {
            let score = 0;
            const pname = p.name.toUpperCase();
            const targetNo = ident.idRaw ? ident.idRaw.replace(/[^0-9]/g, '') : "";
            const paddedNo = ident.paddedNumber || targetNo.padStart(3, '0');

            // CRITICAL: Extract card number from SNKRDUNK bracket format
            // e.g., "Mew AR[s12a 183/172]" → bracketNum="183", bracketSet="S12A"
            const bracketMatch = pname.match(/\[([^\]]*?)(\d+)\s*\/\s*\d+\]/);
            const bracketNum = bracketMatch ? bracketMatch[2] : null;
            const bracketSet = bracketMatch ? bracketMatch[1].trim().replace(/\s+/g, '').toUpperCase() : null;

            // PRE-BRACKET name (the actual card name, before "[")
            const preBracket = pname.split('[')[0].trim();
            // Strip rarity suffixes for cleaner name matching
            const cleanPName = preBracket.replace(/\b(AR|SAR|SR|UR|HR|RRR|RR|R|U|C|P|PROMO|HOLO|EX|GX|V|VSTAR|VMAX)\b/g, '').replace(/\s+/g, ' ').trim();

            // 1. STRICT NUMBER MATCHING via bracket extraction
            if (targetNo && bracketNum) {
                const targetInt = parseInt(targetNo, 10);
                const bracketInt = parseInt(bracketNum, 10);
                if (targetInt === bracketInt) {
                    score += 100; // Strong match: bracket number matches
                } else {
                    return -1000; // DISQUALIFY: bracket number doesn't match
                }
            } else if (targetNo) {
                // No bracket found — fallback to fuzzy matching
                const idRegex = new RegExp(`(?<!\\d)${targetNo}(?!\\d)`);
                if (idRegex.test(pname)) {
                    score += 30;
                } else {
                    score += 5; // Very weak match
                }
            }

            // 2. SET CODE MATCHING (from bracket)
            if (ident.setMarker && bracketSet) {
                const targetSet = ident.setMarker.toUpperCase().replace(/[^A-Z0-9]/g, '');
                if (bracketSet.includes(targetSet) || targetSet.includes(bracketSet)) {
                    score += 50; // Set code from bracket matches
                }
            }

            // 3. NAME MATCHING (using pre-bracket name)
            const targetSubject = (ident.subject || '').toUpperCase().replace(/\s+(EX|GX|V|VSTAR|VMAX)\s*$/i, '').trim();
            const targetNormalized = targetSubject.replace(/[^A-Z0-9]/g, '');
            const pNormalized = cleanPName.replace(/[^A-Z0-9]/g, '');

            if (targetNormalized && pNormalized) {
                if (pNormalized === targetNormalized) {
                    score += 80; // Exact name match
                } else if (targetNormalized.length >= 4 && pNormalized.includes(targetNormalized)) {
                    score += 40; // Substring match (safe for longer names)
                } else if (targetNormalized.length < 4 && pNormalized === targetNormalized) {
                    score += 80; // Short exact match only
                } else {
                    // Check individual significant words
                    const words = targetSubject.split(/\s+/).filter(w => w.length > 2);
                    const matched = words.filter(w => cleanPName.includes(w));
                    score += matched.length * 10;
                }
            }

            // 4. Year & Language (minor bonuses)
            if (ident.year && pname.includes(ident.year)) score += 10;
            if (ident.language && pname.includes(ident.language.toUpperCase())) score += 5;

            // 5. Special cards
            if ((ident.subject || '').toUpperCase().includes('LV.X') && pname.includes('LV.X')) {
                score += 20;
            }

            // 6. VARIANT KEYWORD MATCHING (from PSA cert label)
            if (ident.variantKeywords && ident.variantKeywords.length > 0) {
                const hasVariantMatch = ident.variantKeywords.some(vk => pname.includes(vk.toUpperCase()));
                if (hasVariantMatch) {
                    score += 200; // Strong bonus: variant keyword matches product name
                    console.log(`[SCORE] +200 variant match for "${p.name}"`);
                } else {
                    // Check if this product has ANY variant suffix (colon in pre-bracket = variant)
                    const hasVariantSuffix = preBracket.includes(':');
                    if (hasVariantSuffix) {
                        score -= 500; // Wrong variant — disqualify
                        console.log(`[SCORE] -500 wrong variant for "${p.name}"`);
                    } else {
                        // No variant suffix = regular/base card — penalize but don't fully disqualify
                        score -= 100;
                        console.log(`[SCORE] -100 base variant for "${p.name}" (expected variant)`);
                    }
                }
            }

            // 7. FMV PRICE PROXIMITY (STRONG signal when variants have drastically different prices)
            // SNKRDUNK minPrice is the raw listing price; FMV is the PSA 10 fair market value
            // For same-number variants, this is often the ONLY way to pick the right one
            if (ident.fmvPriceUSD > 0 && p.minPrice) {
                const productPrice = parseFloat(p.minPrice) || 0;
                if (productPrice > 0) {
                    const ratio = productPrice / ident.fmvPriceUSD;
                    console.log(`[SCORE] FMV check for "${p.name}": minPrice=$${productPrice}, FMV=$${ident.fmvPriceUSD}, ratio=${ratio.toFixed(4)}`);
                    if (ratio >= 0.05 && ratio <= 10.0) {
                        // Price is in a plausible range of FMV — strong bonus
                        score += 150;
                        console.log(`[SCORE] +150 FMV proximity for "${p.name}"`);
                    } else if (ratio < 0.05) {
                        // Product price is drastically below FMV — very likely wrong variant
                        score -= 200;
                        console.log(`[SCORE] -200 FMV mismatch for "${p.name}" (way too cheap vs FMV)`);
                    }
                }
            }

            return score;
        }

        // SPEED OPTIMIZATION: Run primary queries in parallel
        const queries = [identity.preciseQuery, identity.smartQuery, identity.leanQuery, identity.idRaw].filter(q => q && q.length >= 2);
        const resultsArray = await Promise.all(queries.map(fetchProducts));
        let allProducts = resultsArray.flat();

        // If no products found, try the smartQuery fallback
        if (allProducts.length === 0) {
            allProducts = await fetchProducts(identity.smartQuery);
        }

        const scored = allProducts
            .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
            .map(p => ({ p, score: scoreProduct(p, identity) }))
            .sort((a, b) => b.score - a.score);

        const bestMatch = scored.length > 0 && scored[0].score > 10 ? scored[0].p : null;

        if (!bestMatch) {
            handleNoMatch(identity);
            return;
        }

        const productId = bestMatch.id;
        viewBtn.onclick = () => { chrome.tabs.create({ url: `https://snkrdunk.com/en/trading-cards/${productId}?slide=right` }); };

        // SPEED OPTIMIZATION: Fetch all pages of listings in parallel
        const pages = [1, 2, 3, 4];
        const urls = pages.map(p => `https://snkrdunk.com/en/v1/trading-cards/${productId}/used-listings?perPage=50&page=${p}&sortType=latest&isOnlyOnSale=false`);

        // Fetch ALL trading history with parallel batch fetching
        async function fetchTradingHistory(pid) {
            const cleanPid = pid.toString().trim();
            const perPage = 100;
            const batchSize = 5; // Fetch 5 pages at a time in parallel
            let startPage = 1;
            let allHistories = [];
            let hasMore = true;

            console.log(`[DEBUG] Fetching history (parallel batches) for PID: ${cleanPid}`);

            while (hasMore) {
                // Build batch of URLs
                const urls = [];
                for (let p = startPage; p < startPage + batchSize; p++) {
                    urls.push(`https://snkrdunk.com/en/v1/streetwears/${cleanPid}/trading-histories?perPage=${perPage}&page=${p}`);
                }

                console.log(`[DEBUG] Fetching pages ${startPage}-${startPage + batchSize - 1} in parallel`);

                try {
                    // Fetch batch in parallel
                    const responses = await Promise.all(
                        urls.map(url => fetch(url, {
                            method: 'GET',
                            credentials: 'include',
                            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
                        }).catch(() => null))
                    );

                    // Process responses in order
                    let batchCount = 0;
                    for (let i = 0; i < responses.length; i++) {
                        const resp = responses[i];
                        if (resp && resp.ok) {
                            const data = await resp.json();
                            if (data.histories && data.histories.length > 0) {
                                allHistories = allHistories.concat(data.histories);
                                batchCount += data.histories.length;

                                // If this page has less than perPage, no more pages
                                if (data.histories.length < perPage) {
                                    hasMore = false;
                                    break;
                                }
                            } else {
                                hasMore = false;
                                break;
                            }
                        } else {
                            hasMore = false;
                            break;
                        }
                    }

                    console.log(`>> Batch loaded ${batchCount} items (Total: ${allHistories.length})`);
                    startPage += batchSize;

                } catch (e) {
                    console.error("History Fetch Error", e);
                    hasMore = false;
                }
            }

            console.log(`>> Total history items fetched: ${allHistories.length}`);
            return allHistories;
        }



        try {
            const responses = await Promise.all(urls.map(url => fetch(url).catch(() => null)));
            const dataResults = await Promise.all(responses.map(r => r && r.ok ? r.json() : { usedTradingCards: [] }));
            const listings = dataResults.flatMap(d => d.usedTradingCards || []);

            // New: Fetch history in parallel or after listings
            const history = await fetchTradingHistory(productId);
            console.log("Fetched History:", history.length);

            // New: Fetch population from Gemrate
            fetchGemratePop(identity);

            processAndRenderData(listings, history);
        } catch (e) {
            console.error("Listing Fetch Error", e);
            handleNoMatch(identity);
        }
    }

    function processAndRenderData(listings, history = []) {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        const psa10Listings = listings.filter(l => (l.condition || "").toUpperCase().includes("PSA 10"));

        // Currency Conversion — detect currency from first price, use live rate for JPY
        const fixedPrefix = "$ ";
        let conversionRate = 1.0;

        const firstPriceStr = (psa10Listings[0] && psa10Listings[0].price) ||
            (history[0] && history[0].price) ||
            (listings[0] && listings[0].price);

        if (firstPriceStr) {
            const priceStr = firstPriceStr.toString().toUpperCase();
            if (priceStr.includes("HK")) {
                conversionRate = 0.128;
                console.log("[FX] Detected HKD");
            } else if (priceStr.includes("JP") || priceStr.includes("¥")) {
                // Use live rate if available, fallback to hardcoded
                const jpyRate = _cachedJpyRate || 150.0;
                conversionRate = 1.0 / jpyRate;
                console.log(`[FX] Detected JPY. Using rate ${conversionRate.toFixed(6)} (1 USD = ¥${jpyRate})`);
            } else if (priceStr.includes("SG")) {
                conversionRate = 0.74;
                console.log("[FX] Detected SGD");
            }
        }

        const convert = (val) => {
            const num = parsePrice(val);
            if (num === 0) return "0";
            return Math.round(num * conversionRate).toLocaleString();
        };

        // 1. Live Price - prioritize newest available listing (not sold)
        if (psa10Listings.length > 0) {
            const newestListing = psa10Listings.find(l => !l.isSold);
            const latestSold = psa10Listings.find(l => l.isSold);

            if (newestListing) {
                psa10PriceEl.textContent = `${fixedPrefix}${convert(newestListing.price)}`;
                psa10StatusEl.textContent = "Newest Listing";
            } else if (latestSold) {
                psa10PriceEl.textContent = `${fixedPrefix}${convert(latestSold.price)}`;
                psa10StatusEl.textContent = "Latest Sale (Listings)";
            } else {
                psa10PriceEl.textContent = `${fixedPrefix}${convert(psa10Listings[0].price)}`;
                psa10StatusEl.textContent = "Live Listing";
            }
        } else if (history.length > 0) {
            // Fallback to history for price if no listings found (PSA 10 only)
            const psa10Only = history.filter(h => (h.condition || "").toUpperCase().includes("PSA 10"));
            const latest = psa10Only[0] || history[0];
            psa10PriceEl.textContent = latest.price ? `${fixedPrefix}${convert(latest.price)}` : "N/A";
            psa10StatusEl.textContent = psa10Only.length > 0 ? "Latest Sale (PSA 10)" : "Latest Sale (History)";
        } else {
            psa10PriceEl.textContent = "N/A";
            psa10StatusEl.textContent = "No Data Found";
        }

        const parseSnkrdunkDate = (dateStr) => {
            if (!dateStr) return null;
            let d = new Date(dateStr);
            if (!isNaN(d.getTime())) return d;
            d = new Date(dateStr.replace(/-/g, '/'));
            if (!isNaN(d.getTime())) return d;
            return null;
        };

        // FILTER: Only PSA 10 items
        const psa10History = history.filter(h => (h.condition || "").toUpperCase().includes("PSA 10"));
        const dataSource = psa10History;

        if (dataSource.length > 0) console.log("History Keys:", Object.keys(dataSource[0]));
        console.log(`Using History API (PSA 10 Only). Items: ${dataSource.length} (filtered from ${history.length})`);

        // 2. Units Sold (30D)
        const soldIn30 = dataSource.filter(item => {
            const date = parseSnkrdunkDate(item.tradedAt);
            return date && date >= thirtyDaysAgo;
        });
        if (totalUnitsSoldEl) {
            totalUnitsSoldEl.textContent = soldIn30.length.toString();
        }

        // 3. Stats (High/Low/Avg) - Use HISTORY 30D with OUTLIER FILTERING
        if (soldIn30.length > 0) {
            const rawPrices = soldIn30.map(h => parsePrice(h.price)).filter(p => p > 0);

            if (rawPrices.length > 0) {
                // Calculate IQR for robust outlier detection
                const sorted = [...rawPrices].sort((a, b) => a - b);
                const q1Index = Math.floor(sorted.length * 0.25);
                const q3Index = Math.floor(sorted.length * 0.75);
                const q1 = sorted[q1Index];
                const q3 = sorted[q3Index];
                const iqr = q3 - q1;

                // Filter outliers: exclude prices > Q3 + 1.5×IQR (standard statistical method)
                const outlierThreshold = q3 + (iqr * 1.5);
                const filteredPrices = rawPrices.filter(p => p <= outlierThreshold);

                const outliers = rawPrices.filter(p => p > outlierThreshold);
                console.log(`Outlier Threshold: $${Math.round(outlierThreshold)}`);
                console.log(`Outliers: ${outliers.map(p => '$' + p).join(', ') || 'None'}`);

                // Use filtered prices for stats (fallback to raw if all filtered out)
                const prices = filteredPrices.length > 0 ? filteredPrices : rawPrices;
                const outlierCount = rawPrices.length - filteredPrices.length;

                if (outlierCount > 0) {
                    console.log(`[OUTLIER] Filtered ${outlierCount} suspected bulk sales (threshold: $${Math.round(outlierThreshold)})`);
                }

                document.getElementById('high-val').textContent = `${fixedPrefix}${Math.round(Math.max(...prices) * conversionRate).toLocaleString()}`;
                document.getElementById('low-val').textContent = `${fixedPrefix}${Math.round(Math.min(...prices) * conversionRate).toLocaleString()}`;
                const avgVal = (prices.reduce((a, b) => a + b, 0) / prices.length) * conversionRate;
                document.getElementById('avg-val').textContent = `${fixedPrefix}${Math.round(avgVal).toLocaleString()}`;
                avgPriceEl.textContent = `${fixedPrefix}${Math.round(avgVal).toLocaleString()}`;
            }
        } else {
            // Reset if no history
            document.getElementById('high-val').textContent = "--";
            document.getElementById('low-val').textContent = "--";
            document.getElementById('avg-val').textContent = "--";
            avgPriceEl.textContent = "--";
        }

        // 4. History List
        const formatDate = (dateStr) => {
            if (!dateStr) return "--";
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return "--";
            return d.toISOString().split('T')[0]; // YYYY-MM-DD
        };

        if (historyListEl) {
            const recent5 = dataSource.slice(0, 5);
            historyListEl.innerHTML = recent5.map(item => `
                <div class="history-item">
                    <span class="h-condition">${(item.condition || "SOLD").toUpperCase()}</span>
                    <span class="h-price">${fixedPrefix}${convert(item.price)}</span>
                    <span class="h-status">DATE: ${formatDate(item.tradedAt)}</span>
                </div>
            `).join('') || '<div class="history-item loading">No history data found</div>';
        }

        renderAdvancedChart(dataSource);
    }

    function renderAdvancedChart(dataItems) {
        const container = document.getElementById('chart-area');
        const monthsRow = document.getElementById('months-row');
        if (!container) return;

        const now = new Date();
        // Changed to 2 months
        const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
        twoMonthsAgo.setHours(0, 0, 0, 0);

        const weeks = [];
        let current = new Date(twoMonthsAgo);
        while (current <= now) {
            weeks.push({ start: new Date(current), end: new Date(new Date(current).setDate(current.getDate() + 7)), prices: [], volume: 0 });
            current.setDate(current.getDate() + 7);
        }

        dataItems.forEach(item => {
            const dateStr = item.tradedAt;
            if (!dateStr) return;

            let date = new Date(dateStr);
            if (isNaN(date.getTime())) {
                date = new Date(dateStr.replace(/-/g, '/'));
            }
            if (isNaN(date.getTime()) || date < twoMonthsAgo) return;

            const weekIdx = weeks.findIndex(w => date >= w.start && date < w.end);
            if (weekIdx !== -1) {
                const p = parsePrice(item.price);
                if (p > 0) { weeks[weekIdx].prices.push(p); weeks[weekIdx].volume++; }
            }
        });

        const data = weeks.map(w => ({ avgPrice: w.prices.length > 0 ? w.prices.reduce((a, b) => a + b, 0) / w.prices.length : null, volume: w.volume }));

        const width = container.clientWidth;
        const height = container.clientHeight;
        const leftPadding = 45;  // Space for Y-axis labels
        const rightPadding = 25;
        const topPadding = 25;   // Space for legend
        const bottomPadding = 20;
        const chartWidth = width - leftPadding - rightPadding;
        const chartHeight = height - topPadding - bottomPadding;

        const prices_all = data.map(d => d.avgPrice).filter(p => p !== null);
        const minPrice = prices_all.length > 0 ? Math.min(...prices_all) * 0.9 : 0;
        const maxPrice = prices_all.length > 0 ? Math.max(...prices_all) * 1.1 : 1000;
        const maxVol = Math.max(...data.map(d => d.volume), 1) * 1.2;

        let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

        // Legend (compact)
        svg += `<g transform="translate(${leftPadding}, 8)">`;
        svg += `<line x1="0" y1="0" x2="15" y2="0" stroke="#00d4ff" stroke-width="2"/>`;
        svg += `<text x="18" y="3" fill="#8899aa" font-size="9">USD</text>`;
        svg += `<rect x="55" y="-5" width="10" height="10" fill="rgba(0, 212, 255, 0.3)"/>`;
        svg += `<text x="68" y="3" fill="#8899aa" font-size="9">Vol</text>`;
        svg += `</g>`;

        // Left Y-axis (Price)
        const priceSteps = 3;
        for (let i = 0; i <= priceSteps; i++) {
            const price = minPrice + (maxPrice - minPrice) * (i / priceSteps);
            const y = topPadding + chartHeight - (chartHeight * i / priceSteps);
            svg += `<text x="${leftPadding - 3}" y="${y + 3}" fill="#00d4ff" font-size="8" text-anchor="end">${Math.round(price)}</text>`;
            svg += `<line x1="${leftPadding}" y1="${y}" x2="${width - rightPadding}" y2="${y}" stroke="rgba(255,255,255,0.1)" />`;
        }

        // Right Y-axis (Volume)
        const volSteps = 3;
        for (let i = 0; i <= volSteps; i++) {
            const vol = Math.round(maxVol * i / volSteps);
            const y = topPadding + chartHeight - (chartHeight * i / volSteps);
            svg += `<text x="${width - rightPadding + 3}" y="${y + 3}" fill="#8899aa" font-size="8" text-anchor="start">${vol}</text>`;
        }

        // Draw bars (no labels on bars)
        const barWidth = Math.max((chartWidth / data.length) * 0.5, 6);
        const step = chartWidth / (data.length - 1 || 1);
        data.forEach((d, i) => {
            const h = Math.max((d.volume / maxVol) * chartHeight, d.volume > 0 ? 3 : 0);
            const x = leftPadding + i * step - barWidth / 2;
            const y = topPadding + chartHeight - h;
            svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" fill="rgba(0, 212, 255, 0.25)" rx="1"/>`;
        });

        // Build points for line
        let points = [];
        data.forEach((d, i) => {
            if (d.avgPrice === null) return;
            const x = leftPadding + i * step;
            const y = topPadding + chartHeight - ((d.avgPrice - minPrice) / (maxPrice - minPrice)) * chartHeight;
            points.push({ x, y });
        });

        // Draw area fill (transparent gradient under line)
        if (points.length > 1) {
            const areaPath = `M ${points[0].x},${topPadding + chartHeight} ` +
                points.map(p => `L ${p.x},${p.y}`).join(' ') +
                ` L ${points[points.length - 1].x},${topPadding + chartHeight} Z`;
            svg += `<path d="${areaPath}" fill="rgba(0, 212, 255, 0.15)" />`;
        }

        // Draw price line
        if (points.length > 1) {
            svg += `<path d="M ${points.map(p => `${p.x},${p.y}`).join(' L ')}" stroke="#00d4ff" stroke-width="2" fill="none" />`;
        }
        points.forEach(p => {
            svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#00d4ff" />`;
        });

        svg += `</svg>`;
        container.innerHTML = svg;

        // X-axis labels (months)
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const months = [];
        let lastMonth = -1;
        weeks.forEach((w) => { if (w.start.getMonth() !== lastMonth) { months.push(monthNames[w.start.getMonth()]); lastMonth = w.start.getMonth(); } });
        monthsRow.innerHTML = months.map(m => `<span>${m}</span>`).join('');
    }

    async function fetchGemratePop(identity) {
        if (!psa10PopEl || !totalGradedPopEl) return;

        // Construct query: Include setMarker if available for better accuracy
        const queryParts = [identity.year, "Pokemon", identity.language, identity.setMarker, identity.fullId, identity.subject];
        const query = queryParts.filter(p => p && p.length > 0).join(' ').replace(/\s+/g, ' ').trim();

        console.log(`[DEBUG] Fetching Pop from Gemrate for: ${query}`);

        try {
            // Step 1: Search for gemrate_id
            const searchUrl = 'https://www.gemrate.com/universal-search-query';
            const searchResp = await fetch(searchUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ query: query })
            });

            if (!searchResp.ok) throw new Error('Gemrate search failed');
            const searchData = await searchResp.json();

            const results = Array.isArray(searchData) ? searchData : (searchData.results || []);
            if (results.length === 0) {
                psa10PopEl.textContent = "N/A";
                totalGradedPopEl.textContent = "N/A";
                return;
            }

            // Pick the best match
            const bestMatch = results[0];
            const gemrateId = bestMatch.gemrate_id;
            console.log(`[DEBUG] Found Gemrate ID: ${gemrateId} from match: ${bestMatch.description}`);

            // Step 2: Fetch the detail page HTML to get the Auth Token
            const detailPageUrl = `https://www.gemrate.com/universal-search?gemrate_id=${gemrateId}`;
            const detailPageResp = await fetch(detailPageUrl);
            if (!detailPageResp.ok) throw new Error('Gemrate detail page fetch failed');
            const detailHtml = await detailPageResp.text();

            // Step 3: Extract the token from the HTML
            // Look for: const cardDetailsToken = "..." or var cardDetailsToken = "..."
            const tokenMatch = detailHtml.match(/(?:var|const)\s+cardDetailsToken\s*=\s*["']([^"']+)["']/);
            const token = tokenMatch ? tokenMatch[1] : null;

            if (!token) {
                console.log("[DEBUG] Auth token not found in HTML, falling back to search data");
                psa10PopEl.textContent = (bestMatch.total_population || "N/A").toLocaleString();
                totalGradedPopEl.textContent = "N/A";
                return;
            }

            // Step 4: Fetch the detail JSON using the token
            const detailApiUrl = `https://www.gemrate.com/card-details?gemrate_id=${gemrateId}`;
            const detailApiResp = await fetch(detailApiUrl, {
                headers: {
                    'Accept': 'application/json',
                    'X-Card-Details-Token': token
                }
            });

            if (!detailApiResp.ok) throw new Error(`Gemrate API failed: ${detailApiResp.status}`);
            const detailData = await detailApiResp.json();

            // Step 5: Parse JSON for PSA data
            const populationData = detailData.population_data || [];
            // Find PSA entry (case-insensitive and robust)
            const psaData = populationData.find(p =>
                (p.grader || "").toUpperCase() === 'PSA' &&
                !(p.grader || "").toUpperCase().includes('PSA/DNA')
            );

            if (psaData) {
                const gemMintPop = psaData.grades ? (psaData.grades.g10 || "0") : "0";
                psa10PopEl.textContent = Number(gemMintPop).toLocaleString();
            } else if (detailData.combined_totals) {
                const gemMintPop = detailData.combined_totals.total_gem_mint || "0";
                psa10PopEl.textContent = Number(gemMintPop).toLocaleString();
            } else {
                psa10PopEl.textContent = (bestMatch.total_population || "N/A").toLocaleString();
            }

            const totalPop = detailData.total_population || (detailData.combined_totals ? detailData.combined_totals.total_population : null);
            if (totalPop !== null) {
                totalGradedPopEl.textContent = Number(totalPop).toLocaleString();
                console.log(`[DEBUG] Pop data found: PSA10=${psa10PopEl.textContent}, Total=${totalGradedPopEl.textContent}`);
            } else {
                totalGradedPopEl.textContent = (bestMatch.total_population || "N/A").toLocaleString();
            }

        } catch (e) {
            console.error("Gemrate Fetch Error:", e);
            psa10PopEl.textContent = "Error";
            totalGradedPopEl.textContent = "Error";
        }
    }

    // ==================== PRICECHARTING INTEGRATION ====================
    async function fetchPriceChartingData(identity) {
        const pcStatusEl = document.getElementById('pc-status');
        const pcUngradedEl = document.getElementById('pc-ungraded');
        const pcPsa9El = document.getElementById('pc-psa9');
        const pcPsa10El = document.getElementById('pc-psa10');
        const pcLinkEl = document.getElementById('pc-link');

        if (!pcStatusEl) return; // UI not present

        pcStatusEl.textContent = 'Searching...';

        // Build search queries (adapted from Unofficial_Renaiss_Monitor)
        const name = (identity.subject || '').replace(/\(.*?\)/g, '').trim();
        const number = (identity.idRaw || '').replace(/^0+/, '') || '0';
        const numberPadded = number.padStart(3, '0');
        const setCode = identity.setMarker || '';

        const queries = [];
        if (setCode) queries.push(`${name} ${setCode} ${number}`);
        queries.push(`${name} ${number}`);
        if (numberPadded !== '000') queries.push(`${name} ${numberPadded}`);

        console.log(`[PC] Searching PriceCharting with queries:`, queries);

        let productPageUrl = null;

        // Step 1: Search for the product
        for (const query of queries) {
            try {
                const searchUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`;
                console.log(`[PC] Trying: ${searchUrl}`);
                const resp = await fetch(searchUrl);
                if (!resp.ok) continue;

                const html = await resp.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Check if we landed directly on a product page
                const productName = doc.querySelector('#product_name');
                if (productName) {
                    productPageUrl = resp.url || searchUrl;
                    console.log(`[PC] Direct product page: ${productPageUrl}`);
                    // Parse prices directly from this page
                    const prices = parsePcPrices(doc);
                    if (prices) {
                        renderPcPrices(prices, productPageUrl);
                        return;
                    }
                }

                // It's a search results page - find best matching product URL
                const links = doc.querySelectorAll('table.offer a[href*="/game/"]');
                if (links.length === 0) {
                    // Try alternative selector
                    const altLinks = doc.querySelectorAll('a[href*="/game/"]');
                    if (altLinks.length === 0) continue;
                    // Use altLinks
                    productPageUrl = findBestPcMatch(Array.from(altLinks), name, number, numberPadded, setCode);
                } else {
                    productPageUrl = findBestPcMatch(Array.from(links), name, number, numberPadded, setCode);
                }

                if (productPageUrl) break;
            } catch (e) {
                console.warn(`[PC] Search error for "${query}":`, e);
            }
        }

        if (!productPageUrl) {
            pcStatusEl.textContent = 'Not Found';
            console.log('[PC] No matching product found on PriceCharting');
            return;
        }

        // Step 2: Fetch the product page and extract prices
        try {
            console.log(`[PC] Fetching product page: ${productPageUrl}`);
            const resp = await fetch(productPageUrl);
            if (!resp.ok) {
                pcStatusEl.textContent = 'Error';
                return;
            }
            const html = await resp.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const prices = parsePcPrices(doc);

            if (prices) {
                renderPcPrices(prices, productPageUrl);
            } else {
                pcStatusEl.textContent = 'No prices';
            }
        } catch (e) {
            console.warn('[PC] Product page fetch error:', e);
            pcStatusEl.textContent = 'Error';
        }

        function findBestPcMatch(linkElements, cardName, num, numPadded, set) {
            const nameSlug = cardName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            const setSlug = set.toLowerCase().replace(/[^a-z0-9]/g, '');

            let bestBoth = null, bestName = null, bestNum = null;

            for (const link of linkElements) {
                const href = link.getAttribute('href');
                if (!href || !href.includes('/game/')) continue;
                const fullUrl = href.startsWith('http') ? href : `https://www.pricecharting.com${href}`;
                const slug = href.split('/').pop().toLowerCase();

                const hasName = nameSlug.split('-').filter(w => w.length > 2).some(w => slug.includes(w));
                const hasNum = slug.includes(num) || slug.includes(numPadded);
                const hasSet = setSlug && slug.replace(/-/g, '').includes(setSlug);

                if (hasName && hasNum) {
                    if (!bestBoth || (hasSet && !bestBoth.hasSet)) {
                        bestBoth = { url: fullUrl, hasSet };
                    }
                } else if (hasName && !bestName) {
                    bestName = fullUrl;
                } else if (hasNum && !bestNum) {
                    bestNum = fullUrl;
                }
            }

            return bestBoth?.url || bestName || bestNum || null;
        }

        function parsePcPrices(doc) {
            // PriceCharting uses these IDs for trading card grades:
            // Ungraded = td#used_price, PSA 9 = td#graded_price, PSA 10 = td#manual_only_price
            const extractPrice = (selector) => {
                const el = doc.querySelector(selector);
                if (!el) return null;
                const text = el.textContent.trim();
                const match = text.match(/\$[\d,]+\.?\d*/);
                if (!match) return null;
                return parseFloat(match[0].replace(/[$,]/g, ''));
            };

            const ungraded = extractPrice('td#used_price .price') || extractPrice('td#used_price');
            const psa9 = extractPrice('td#graded_price .price') || extractPrice('td#graded_price');
            const psa10 = extractPrice('td#manual_only_price .price') || extractPrice('td#manual_only_price');

            if (ungraded === null && psa9 === null && psa10 === null) return null;

            return { ungraded, psa9, psa10 };
        }

        function renderPcPrices(prices, url) {
            const fmt = (v) => v !== null && v > 0 ? `$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A';

            if (pcUngradedEl) pcUngradedEl.textContent = fmt(prices.ungraded);
            if (pcPsa9El) pcPsa9El.textContent = fmt(prices.psa9);
            if (pcPsa10El) pcPsa10El.textContent = fmt(prices.psa10);
            if (pcStatusEl) pcStatusEl.textContent = '✓ Found';
            if (pcLinkEl) {
                pcLinkEl.href = url;
                pcLinkEl.style.display = 'block';
                pcLinkEl.onclick = (e) => {
                    e.preventDefault();
                    chrome.tabs.create({ url: url });
                };
            }

            console.log(`[PC] Prices rendered - Ungraded: ${prices.ungraded}, PSA 9: ${prices.psa9}, PSA 10: ${prices.psa10}`);
        }
    }
    // ==================== END PRICECHARTING ====================

    function resetUI() {
        psa10PriceEl.textContent = "...";
        avgPriceEl.textContent = "...";
        psa10StatusEl.textContent = "Searching...";
        document.getElementById('high-val').textContent = "--";
        document.getElementById('avg-val').textContent = "--";
        document.getElementById('low-val').textContent = "--";
        if (totalUnitsSoldEl) totalUnitsSoldEl.textContent = "...";
        if (psa10PopEl) psa10PopEl.textContent = "...";
        if (totalGradedPopEl) totalGradedPopEl.textContent = "...";
        if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">Loading history...</div>';
        // Reset PC section
        const pcStatusEl = document.getElementById('pc-status');
        const pcUngradedEl = document.getElementById('pc-ungraded');
        const pcPsa9El = document.getElementById('pc-psa9');
        const pcPsa10El = document.getElementById('pc-psa10');
        const pcLinkEl = document.getElementById('pc-link');
        if (pcStatusEl) pcStatusEl.textContent = 'Searching...';
        if (pcUngradedEl) pcUngradedEl.textContent = '--';
        if (pcPsa9El) pcPsa9El.textContent = '--';
        if (pcPsa10El) pcPsa10El.textContent = '--';
        if (pcLinkEl) pcLinkEl.style.display = 'none';
    }

    function handleNoMatch(identity) {
        psa10PriceEl.textContent = "N/A";
        psa10StatusEl.textContent = "No match";
        avgPriceEl.textContent = "N/A";
        if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">No product found</div>';
        const manualUrl = `https://snkrdunk.com/en/search/result?keyword=${encodeURIComponent(identity.leanQuery || identity.fullId || "Pokemon")}`;
        viewBtn.onclick = () => { chrome.tabs.create({ url: manualUrl }); };
    }
});
