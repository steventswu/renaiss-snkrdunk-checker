// popup.js
document.addEventListener('DOMContentLoaded', async () => {
    const cardNameEl = document.getElementById('cardName');
    const psa10PriceEl = document.getElementById('psa10-price');
    const avgPriceEl = document.getElementById('avg-price');
    const psa10StatusEl = document.getElementById('psa10-status');
    const avgStatusEl = document.getElementById('avg-status');
    const viewBtn = document.getElementById('viewOnSnkrdunk');
    const marketMinEl = document.getElementById('market-min');
    const historyListEl = document.getElementById('trade-history-list');
    const totalUnitsSoldEl = document.getElementById('total-units-sold');
    const totalSoldStatusEl = document.getElementById('total-sold-status');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes("renaiss.xyz")) {
            cardNameEl.textContent = "Navigate to Renaiss.xyz";
            psa10StatusEl.textContent = "Waiting for page...";
            avgStatusEl.textContent = "Waiting for page...";
            return;
        }

        const response = await chrome.tabs.sendMessage(tab.id, { action: "getCardTitle" });
        if (response && response.title) {
            cardNameEl.textContent = response.title;
            searchSnkrdunk(response.title);
        } else {
            cardNameEl.textContent = "Card not found";
        }
    } catch (error) {
        console.error("Popup Init Error:", error);
        if (error.message.includes("Could not establish connection")) {
            cardNameEl.textContent = "Please refresh the page";
        } else {
            cardNameEl.textContent = "Error detecting card";
        }
    }

    function refineSearchQuery(title) {
        console.log("Analyzing Title:", title);

        // 1. Noise Stripping (Grade/Condition)
        let cleaned = title.replace(/^(PSA\s*\d+|Gem\s*Mint|Mint|NM|Near\s*Mint|Excellent|Grader\s*PSA)\s+/gi, '');
        cleaned = cleaned.replace(/\b(Trading\s*Card\s*Game|TCG|Card\s*Pack|Edition)\b/gi, '');

        // 2. Metadata Extraction
        const yearMatch = cleaned.match(/\b(20\d{2}|19\d{2})\b/);
        const year = yearMatch ? yearMatch[0] : "";

        const langMatch = cleaned.match(/\b(Japanese|English)\b/i);
        const language = langMatch ? langMatch[0] : "";

        const idMatch = cleaned.match(/(#?\d+[\/\-]\d+|#\d+)/);
        const fullId = idMatch ? idMatch[0] : "";
        const idRaw = fullId.replace('#', '');

        // 3. Set Marker Extraction (e.g., SV8a, SV4a, S8a-P, etc.)
        const setCodeMatch = cleaned.match(/\b(SV\d+[a-z]?|S\d+[a-z]?\-P|S\d+[a-z]?)\b/i);
        const setMarker = setCodeMatch ? setCodeMatch[0].toUpperCase() : "";

        // 4. Robust Subject Identification
        let subject = "";
        if (fullId) {
            const parts = cleaned.split(fullId);
            if (parts.length > 1 && parts[1].trim()) {
                // Name follows ID: "#001 Pikachu"
                const following = parts[1].trim().split(/\s+/).filter(w => !w.startsWith('('));
                subject = following[0] || "";
            } else {
                // Name precedes ID: "Pikachu #001"
                const precedingParts = parts[0].trim().split(/\s+/).filter(w => !['Pokemon', 'Japanese', 'English', year, setMarker].includes(w));
                subject = precedingParts[precedingParts.length - 1] || "";
            }
        }

        // Fallback or secondary cleaning
        if (!subject) {
            const fallbackWords = cleaned.split(/\s+/).filter(w => w.length > 1 && !w.startsWith('('));
            subject = fallbackWords[fallbackWords.length - 1] || "";
        }

        // 5. Lean Subject Cleaning (Remove -Holo, -Reverse, etc.)
        const leanSubject = subject.replace(/[\-\–](Holo|Reverse|Mirror|Parallel|Non\s*Holo|Ex|VMAX|VSTAR|V)\b/gi, '').trim();

        // 6. Construct Query Variants
        const smartQuery = `${year} Pokemon ${language} ${fullId} ${subject}`.replace(/\s+/g, ' ').trim();
        const leanQuery = `${leanSubject} ${idRaw}`.trim();
        const setQuery = `${setMarker} ${idRaw} ${leanSubject}`.trim(); // Add set-based query
        const idQuery = `${idRaw}`.trim();

        console.log("Queries generated:", { smartQuery, leanQuery, setQuery, setMarker });

        return {
            idRaw,
            subject: leanSubject, // Use the lean version for matching
            setMarker,
            smartQuery,
            leanQuery,
            setQuery,
            idQuery,
            fullCleaned: cleaned.trim(),
            year,
            language
        };
    }

    function calculateTrimmedAverage(sales) {
        if (!sales || sales.length === 0) return "N/A";
        const prices = sales.map(s => {
            const p = s.price;
            return parseFloat(p.replace(/[^0-9.]/g, ''));
        }).filter(p => !isNaN(p));
        if (prices.length === 0) return "N/A";
        prices.sort((a, b) => a - b);
        const trimCount = Math.floor(prices.length * 0.10);
        const trimmedPrices = prices.slice(trimCount, prices.length - trimCount);
        if (trimmedPrices.length === 0) return "N/A";
        const sum = trimmedPrices.reduce((acc, val) => acc + val, 0);
        const avg = sum / trimmedPrices.length;
        return `US $${Math.round(avg).toLocaleString()}`;
    }

    async function searchSnkrdunk(title) {
        const identity = refineSearchQuery(title);

        psa10PriceEl.textContent = "...";
        avgPriceEl.textContent = "...";
        psa10StatusEl.textContent = "Searching...";
        avgStatusEl.textContent = "Calculating...";
        if (totalUnitsSoldEl) totalUnitsSoldEl.textContent = "...";
        if (totalSoldStatusEl) totalSoldStatusEl.textContent = "Calculating...";
        if (marketMinEl) marketMinEl.textContent = "Min Market: --";
        if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">Loading history...</div>';

        // Parallel Fetch for the top 3 variants
        const primaryQueries = [identity.setQuery, identity.leanQuery, identity.smartQuery].filter(q => q && q.length > 3);
        const fallbackQueries = [identity.fullCleaned, identity.idQuery].filter(q => q && q.length > 2);

        async function fetchProducts(query) {
            console.log("-> Querying:", query);
            const url = `https://snkrdunk.com/en/v1/search?keyword=${encodeURIComponent(query)}&perPage=20&page=1`;
            try {
                const resp = await fetch(url);
                if (!resp.ok) return [];
                const data = await resp.json();
                return (data.products || []).concat(data.streetwears || []);
            } catch (e) {
                console.error("Fetch failed:", e);
                return [];
            }
        }

        function findBestMatch(products, ident) {
            if (!products || products.length === 0) return null;

            const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            const targetNo = ident.idRaw ? norm(ident.idRaw) : null;
            const targetSubj = ident.subject ? ident.subject.toLowerCase() : null;
            const targetSet = ident.setMarker ? ident.setMarker.toLowerCase() : null;

            // Priority 1: Match BOTH Set marker and Subject/ID
            if (targetSet) {
                const setMatch = products.find(p => {
                    const pname = p.name.toLowerCase();
                    return pname.includes(targetSet) &&
                        (targetNo && norm(pname).includes(targetNo));
                });
                if (setMatch) return setMatch;
            }

            // Priority 2: Contains BOTH ID and Subject
            const best = products.find(p => {
                const pname = p.name.toLowerCase();
                return (targetNo && norm(pname).includes(targetNo)) &&
                    (targetSubj && pname.includes(targetSubj));
            });
            if (best) return best;

            // Priority 2: Contains exact Card Number
            if (targetNo) {
                const match = products.find(p => norm(p.name).includes(targetNo));
                if (match) return match;
            }

            // Priority 3: Subject match on top result
            if (targetSubj && products[0].name.toLowerCase().includes(targetSubj)) {
                return products[0];
            }

            return null;
        }

        let bestMatch = null;
        let successfulQuery = "";

        try {
            // Stage 1: Parallel Primary Search
            const primaryResults = await Promise.all(primaryQueries.map(fetchProducts));
            for (let i = 0; i < primaryResults.length; i++) {
                bestMatch = findBestMatch(primaryResults[i], identity);
                if (bestMatch) {
                    successfulQuery = primaryQueries[i];
                    break;
                }
            }

            // Stage 2: Sequential Fallback
            if (!bestMatch) {
                for (const q of fallbackQueries) {
                    const results = await fetchProducts(q);
                    bestMatch = findBestMatch(results, identity);
                    if (bestMatch) {
                        successfulQuery = q;
                        break;
                    }
                }
            }

            if (!bestMatch) {
                psa10PriceEl.textContent = "N/A";
                avgPriceEl.textContent = "N/A";
                psa10StatusEl.textContent = "No match found";
                avgStatusEl.textContent = "No match found";
                if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">Check title or try manual search</div>';
                const manualUrl = `https://snkrdunk.com/en/search/result?keyword=${encodeURIComponent(identity.leanQuery || "Pokemon")}`;
                viewBtn.onclick = () => { chrome.tabs.create({ url: manualUrl }); };
                return;
            }

            const productId = bestMatch.id;
            console.log("BEST MATCH:", bestMatch.name, "| VIA:", successfulQuery);

            if (marketMinEl) {
                marketMinEl.textContent = `Min Market: ${bestMatch.minPriceFormat || ('$' + bestMatch.minPrice.toLocaleString())}`;
            }

            viewBtn.onclick = () => {
                chrome.tabs.create({ url: `https://snkrdunk.com/en/trading-cards/${productId}?slide=right` });
            };

            const urls = [
                `https://snkrdunk.com/en/v1/trading-cards/${productId}/used-listings?perPage=50&page=1&sortType=latest&isOnlyOnSale=false`,
                `https://snkrdunk.com/en/v1/trading-cards/${productId}/used-listings?perPage=50&page=2&sortType=latest&isOnlyOnSale=false`,
                `https://snkrdunk.com/en/v1/trading-cards/${productId}/used-listings?perPage=50&page=3&sortType=latest&isOnlyOnSale=false`,
                `https://snkrdunk.com/en/v1/trading-cards/${productId}/used-listings?perPage=50&page=4&sortType=latest&isOnlyOnSale=false`
            ];

            const responses = await Promise.all(urls.map(url => fetch(url).catch(() => null)));
            const dataResults = await Promise.all(responses.map(r => r && r.ok ? r.json() : { usedTradingCards: [] }));
            const listings = dataResults.flatMap(d => d.usedTradingCards || []);

            let psa10Price = "N/A";
            let psa10Sales = [];
            let soldHistory = [];

            listings.forEach(listing => {
                const condition = (listing.condition || "Used").toUpperCase();
                const priceStr = listing.price || "N/A";
                const isPSA10 = condition.includes("PSA 10") || condition.includes("PSA10");

                if (!listing.isSold) {
                    if (isPSA10) {
                        const pVal = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
                        const currentMin = psa10Price === "N/A" ? Infinity : parseFloat(psa10Price.replace(/[^0-9.]/g, ''));
                        if (pVal < currentMin) psa10Price = priceStr;
                    }
                } else if (isPSA10) {
                    const updatedAt = listing.updatedAt || "";
                    let isWithin30Days = true;
                    if (updatedAt) {
                        const soldDate = new Date(updatedAt);
                        if (!isNaN(soldDate.getTime())) {
                            const now = new Date();
                            const diffDays = (now - soldDate) / (1000 * 60 * 60 * 24);
                            isWithin30Days = diffDays <= 30;
                        }
                    }

                    if (isWithin30Days) {
                        psa10Sales.push(listing);
                    }

                    if (soldHistory.length < 5) {
                        soldHistory.push({ price: priceStr, grade: condition, status: "SOLD", date: updatedAt });
                    }
                }
            });

            psa10PriceEl.textContent = psa10Price;
            psa10StatusEl.textContent = psa10Price !== "N/A" ? "Live Price" : "Not listed";

            const avgPrice = calculateTrimmedAverage(psa10Sales);
            avgPriceEl.textContent = avgPrice;
            avgStatusEl.textContent = avgPrice !== "N/A" ? "Average Sold" : "No history";

            if (totalUnitsSoldEl) {
                totalUnitsSoldEl.textContent = psa10Sales.length.toString();
                totalSoldStatusEl.textContent = "Units Sold";
            }

            if (historyListEl) {
                if (soldHistory.length > 0) {
                    historyListEl.innerHTML = soldHistory.map(item => `
                        <div class="history-item">
                            <span class="h-condition">${item.grade}</span>
                            <span class="h-price">${item.price}</span>
                            <span class="h-status">${item.status}</span>
                        </div>
                    `).join('');
                } else {
                    historyListEl.innerHTML = '<div class="history-item loading">No recent PSA 10 trades</div>';
                }
            }

        } catch (error) {
            console.error("Search Workflow Failed:", error);
            psa10StatusEl.textContent = "Error";
            avgStatusEl.textContent = "Error";
        }
    }
});
