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
    const tabButtons = document.querySelectorAll('.tab-btn');

    let appState = {
        activeTab: 'snkrdunk',
        snkrdunkData: {
            listings: [],
            history: []
        },
        priceChartingData: null,
        identity: null
    };

    // Tab Switching Logic
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (appState.activeTab === tab) return;

            // Update UI state
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            appState.activeTab = tab;

            // Render existing data for the selected tab
            renderTabContent();
        });
    });

    function renderTabContent() {
        if (appState.activeTab === 'snkrdunk') {
            // Restore SNKRDUNK Labels
            document.querySelector('#avg-price-card .label').textContent = "30-Day Avg (PSA 10)";
            document.querySelector('#psa10-pop-card .label').textContent = "PSA 10 POP";
            document.querySelector('#total-pop-card .label').textContent = "TOTAL GRADED";

            // Restore High/Low labels
            const subStats = document.querySelectorAll('.sub-stats .stat-item');
            if (subStats.length >= 2) {
                subStats[0].querySelector('.s-label').textContent = "High";
                subStats[1].querySelector('.s-label').textContent = "Low";
            }

            // Show sections
            document.querySelector('.advanced-market-card').style.display = 'block';
            document.querySelector('.history-section').style.display = 'block';

            if (appState.snkrdunkData.listings.length > 0 || appState.snkrdunkData.history.length > 0) {
                processAndRenderData(appState.snkrdunkData.listings, appState.snkrdunkData.history);
            } else {
                resetUI();
            }
        } else if (appState.activeTab === 'pricecharting') {
            // Update labels for PriceCharting
            document.querySelector('#avg-price-card .label').textContent = "Market Values (USD)";
            document.querySelector('#psa10-pop-card .label').textContent = "PSA 10";

            // Hide SNKRDUNK specific elements immediately while loading
            document.querySelector('.advanced-market-card').style.display = 'none';
            document.querySelector('.history-section').style.display = 'none';
            if (psa10PopEl) psa10PopEl.textContent = "N/A";
            if (totalGradedPopEl) totalGradedPopEl.textContent = "N/A";
            if (totalUnitsSoldEl) totalUnitsSoldEl.textContent = "N/A";

            if (appState.priceChartingData) {
                renderPriceChartingData(appState.priceChartingData);
            } else {
                resetUI();
                if (appState.identity) {
                    fetchPriceChartingData(appState.identity);
                }
            }
        }
    }

    if (closeBtn) {
        closeBtn.onclick = () => {
            console.log('Close button clicked');
            window.parent.postMessage('closeSnkrdunkModal', '*');
        };
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
            appState.identity = refineSearchQuery(response);
            searchSnkrdunk(appState.identity);
        } else {
            cardNameEl.textContent = "Card not found";
        }
    } catch (error) {
        console.error("Popup Init Error:", error);
    }

    function refineSearchQuery(metadata) {
        // If we have structured metadata, use it to build a super precise query
        if (metadata.name && metadata.number) {
            const cleanName = metadata.name.replace(/Lv\.X/g, '').trim();
            const setMarker = metadata.set || "";
            const year = metadata.year || "";
            const lang = metadata.language || "Japanese";

            return {
                idRaw: metadata.number.replace('#', '').trim(),
                fullId: metadata.number,
                subject: metadata.name,
                setMarker: setMarker,
                year: year,
                language: lang,
                // Primary query: Set + Number + Name
                smartQuery: `${year} Pokemon ${lang} ${metadata.number} ${cleanName}`.replace(/\s+/g, ' ').trim(),
                // Ultra Precise: Set + Number
                preciseQuery: `${setMarker} ${metadata.number}`.trim(),
                leanQuery: `${cleanName} ${metadata.number}`.trim(),
                setQuery: `${setMarker} ${metadata.number}`.trim()
            };
        }

        // Fallback to old parsing if metadata is incomplete
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

        const setCodeMatch = title.match(/\b([A-Z]{1,4}(?:\d+)?(?:\-[A-Z]+)?)\b/g) || [];
        const setMarker = setCodeMatch.find(m => !['PSA', 'TCG', 'GEM', 'CGC', 'BGS', 'USA', '2023'].includes(m.toUpperCase())) || "";

        let subject = cleaned.replace(year, '').replace(language, '').replace(fullId, '').replace(/\s+/g, ' ').trim();
        const words = subject.split(/\s+/).filter(w => w.length > 2);
        const leanSubject = words[0] || "";

        return {
            idRaw,
            fullId,
            subject,
            setMarker: setMarker.toUpperCase(),
            year,
            language,
            smartQuery: `${year} Pokemon ${language} ${fullId} ${leanSubject}`.replace(/\s+/g, ' ').trim(),
            leanQuery: `${leanSubject} ${idRaw}`.trim(),
            setQuery: `${setMarker} ${idRaw}`.trim()
        };
    }

    async function searchSnkrdunk(identity) {
        resetUI();

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
            const normPname = pname.replace(/[^A-Z0-9]/g, '');
            const targetNo = ident.idRaw ? ident.idRaw.replace(/[^A-Z0-9]/g, '') : "";

            if (targetNo) {
                // Precise number matching
                const idRegex = new RegExp(`(?<!\\d)${targetNo}(?!\\d)`);
                if (idRegex.test(pname)) {
                    score += 40; // Increased weight for number
                    if (ident.idRaw.includes('/') && pname.includes(ident.idRaw)) score += 10;
                } else if (normPname.includes(targetNo)) {
                    score += 15;
                }
            }

            // Language score
            if (ident.language && pname.includes(ident.language.toUpperCase())) score += 20;

            if (ident.setMarker && pname.includes(ident.setMarker.toUpperCase())) score += 25;

            if (ident.year) {
                if (pname.includes(ident.year)) score += 15;
                else if (/\b(19|20)\d{2}\b/.test(pname)) score -= 30; // Penalize different years
            }

            const subjWords = ident.subject.toUpperCase().split(/\s+/).filter(w => w.length > 3);
            subjWords.forEach(w => {
                const cleanW = w.replace(/[^A-Z0-9]/g, '');
                if (cleanW.length > 3 && pname.includes(cleanW)) score += 10;
            });

            if (ident.subject.toUpperCase().includes('LV.X') && pname.includes('LV.X')) {
                score += 20;
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

        // Fetch trading history for stats
        // Fetch trading history with endpoint templates
        // Fetch trading history with endpoint templates
        // Fetch trading history for stats (Strict Streetwears Endpoint)
        // Fetch trading history for stats (Strict Streetwears Endpoint)
        // Fetch trading history with robust fallback (Streetwears First)
        // Fetch ALL trading history with dynamic pagination
        // OPTIMIZED: Fetch history pages in PARALLEL (max 3 pages = 300 items)
        // Fetch ALL trading history with dynamic pagination
        // OPTIMIZED: Parallel batch fetching (no page limit, gets ALL data)
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

            appState.snkrdunkData = { listings, history };
            if (appState.activeTab === 'snkrdunk') {
                processAndRenderData(listings, history);
            }
        } catch (e) {
            console.error("Listing Fetch Error", e);
            handleNoMatch(identity);
        }
    }

    async function fetchPriceChartingData(identity) {
        console.log("[DEBUG] Fetching PriceCharting Data for:", identity.smartQuery);

        const trySearch = async (query) => {
            const searchUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=videogames`;
            const resp = await fetch(searchUrl);
            if (!resp.ok) return null;
            const html = await resp.text();
            const parser = new DOMParser();
            return parser.parseFromString(html, 'text/html');
        };

        try {
            // Stage 1: Precise Search
            const query1 = `${identity.year} ${identity.subject} ${identity.idRaw} ${identity.language}`.replace(/\s+/g, ' ').trim();
            let doc = await trySearch(query1);

            // Check results
            let isProductPage = doc ? doc.getElementById('price_renderer') : false;
            let results = doc ? doc.querySelectorAll('#search-results tr') : [];

            // Stage 2: Lean Search if precise failed
            if (!isProductPage && results.length === 0) {
                console.log("[DEBUG] PC Precise search failed, trying lean query...");
                const query2 = `${identity.subject} ${identity.idRaw}`.trim();
                doc = await trySearch(query2);
                isProductPage = doc ? doc.getElementById('price_renderer') : false;
                results = doc ? doc.querySelectorAll('#search-results tr') : [];
            }

            if (!doc) throw new Error("PriceCharting fetch failed");

            let productDoc = doc;
            if (!isProductPage) {
                if (results.length === 0) {
                    handlePCNoMatch();
                    return;
                }
                const firstLink = results[0].querySelector('a.title');
                if (!firstLink) {
                    handlePCNoMatch();
                    return;
                }
                const productUrl = "https://www.pricecharting.com" + firstLink.getAttribute('href');
                const productResp = await fetch(productUrl);
                const productHtml = await productResp.text();
                productDoc = new DOMParser().parseFromString(productHtml, 'text/html');
            }

            // Parse Prices
            const getPrice = (id) => {
                const el = productDoc.getElementById(id);
                if (!el) return null;
                const priceText = el.querySelector('.price')?.textContent || el.textContent;
                return priceText.replace(/[^0-9.]/g, '').trim();
            };

            const data = {
                ungraded: getPrice('ungraded_price'),
                psa9: getPrice('grade_9_price'),
                psa10: getPrice('psa_10_price'),
                title: productDoc.querySelector('#product_name')?.textContent?.trim() || "Unknown Card"
            };

            appState.priceChartingData = data;
            if (appState.activeTab === 'pricecharting') {
                renderPriceChartingData(data);
            }

        } catch (e) {
            console.error("PriceCharting Fetch Error:", e);
            if (appState.activeTab === 'pricecharting') {
                handlePCNoMatch();
            }
        }
    }

    function renderPriceChartingData(data) {
        psa10PriceEl.textContent = data.psa10 ? `$${data.psa10}` : "N/A";
        psa10StatusEl.textContent = "PriceCharting PSA 10";

        document.getElementById('avg-val').textContent = data.psa10 ? `$${data.psa10}` : "--";
        document.getElementById('high-val').textContent = data.psa9 ? `$${data.psa9}` : "--";
        document.getElementById('low-val').textContent = data.ungraded ? `$${data.ungraded}` : "--";

        // Update labels for the mini-stats
        const subStats = document.querySelectorAll('.sub-stats .stat-item');
        if (subStats.length >= 2) {
            subStats[0].querySelector('.s-label').textContent = "Grade 9";
            subStats[1].querySelector('.s-label').textContent = "Ungraded";
        }

        // Hide chart and history as we don't have them for PC yet
        document.querySelector('.advanced-market-card').style.display = 'none';
        document.querySelector('.history-section').style.display = 'none';

        const pcUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(data.title)}&type=videogames`;
        viewBtn.textContent = "View on PriceCharting";
        viewBtn.onclick = () => { chrome.tabs.create({ url: pcUrl }); };
    }

    function handlePCNoMatch() {
        psa10PriceEl.textContent = "N/A";
        psa10StatusEl.textContent = "No match on PriceCharting";

        document.getElementById('avg-val').textContent = "--";
        document.getElementById('high-val').textContent = "--";
        document.getElementById('low-val').textContent = "--";

        if (psa10PopEl) psa10PopEl.textContent = "N/A";
        if (totalGradedPopEl) totalGradedPopEl.textContent = "N/A";
        if (totalUnitsSoldEl) totalUnitsSoldEl.textContent = "N/A";

        // Hide chart and history
        document.querySelector('.advanced-market-card').style.display = 'none';
        document.querySelector('.history-section').style.display = 'none';

        viewBtn.textContent = "Search PriceCharting";
        viewBtn.onclick = () => {
            const query = appState.identity ? `${appState.identity.subject} ${appState.identity.idRaw}` : "Pokemon";
            chrome.tabs.create({ url: `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=videogames` });
        };
    }

    function processAndRenderData(listings, history = []) {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        const psa10Listings = listings.filter(l => (l.condition || "").toUpperCase().includes("PSA 10"));

        // 1. Live Price - prioritize newest available listing (not sold)
        if (psa10Listings.length > 0) {
            const newestListing = psa10Listings.find(l => !l.isSold);
            const latestSold = psa10Listings.find(l => l.isSold);

            if (newestListing) {
                psa10PriceEl.textContent = newestListing.price || "N/A";
                psa10StatusEl.textContent = "Newest Listing";
            } else if (latestSold) {
                psa10PriceEl.textContent = latestSold.price || "N/A";
                psa10StatusEl.textContent = "Latest Sale (Listings)";
            } else {
                psa10PriceEl.textContent = psa10Listings[0].price || "N/A";
                psa10StatusEl.textContent = "Live Listing";
            }
        } else if (history.length > 0) {
            // Fallback to history for price if no listings found (PSA 10 only)
            const psa10Only = history.filter(h => (h.condition || "").toUpperCase().includes("PSA 10"));
            const latest = psa10Only[0] || history[0];
            psa10PriceEl.textContent = latest.price ? `US $${latest.price}` : "N/A";
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
            const rawPrices = soldIn30.map(h => parseFloat((h.price || "0").toString().replace(/[^0-9.]/g, ''))).filter(p => !isNaN(p) && p > 0);

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

                document.getElementById('high-val').textContent = `$${Math.round(Math.max(...prices)).toLocaleString()}`;
                document.getElementById('low-val').textContent = `$${Math.round(Math.min(...prices)).toLocaleString()}`;
                const avgVal = prices.reduce((a, b) => a + b, 0) / prices.length;
                document.getElementById('avg-val').textContent = `$${Math.round(avgVal).toLocaleString()}`;
                avgPriceEl.textContent = `US $${Math.round(avgVal).toLocaleString()}`;
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
                    <span class="h-price">US $${item.price}</span>
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
                const p = parseFloat((item.price || "0").toString().replace(/[^0-9.]/g, ''));
                if (!isNaN(p)) { weeks[weekIdx].prices.push(p); weeks[weekIdx].volume++; }
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
