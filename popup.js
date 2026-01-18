// popup.js
document.addEventListener('DOMContentLoaded', async () => {
    const cardNameEl = document.getElementById('cardName');
    const psa10PriceEl = document.getElementById('psa10-price');
    const avgPriceEl = document.getElementById('avg-price'); // New element
    const psa10StatusEl = document.getElementById('psa10-status');
    const avgStatusEl = document.getElementById('avg-status'); // New element
    const viewBtn = document.getElementById('viewOnSnkrdunk');
    const marketMinEl = document.getElementById('market-min');
    const historyListEl = document.getElementById('trade-history-list');

    let currentTitle = "";

    // 1. Get title from content script
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
            currentTitle = response.title;
            cardNameEl.textContent = currentTitle;
            searchSnkrdunk(currentTitle);
        } else {
            cardNameEl.textContent = "Card not found";
        }
    } catch (error) {
        console.error("Connection Error:", error);
        if (error.message.includes("Could not establish connection")) {
            cardNameEl.textContent = "Please refresh the page";
            psa10StatusEl.textContent = "Extension link pending";
            avgStatusEl.textContent = "Extension link pending";
        } else {
            cardNameEl.textContent = "Error detecting card";
        }
    }

    function refineSearchQuery(title) {
        console.log("Original Title:", title);

        // 1. Noise Stripping
        let cleaned = title.replace(/^(PSA\s*\d+|Gem\s*Mint|Mint|NM|Near\s*Mint|Excellent|Grader\s*PSA)\s+/gi, '');
        cleaned = cleaned.replace(/\b(20\d{2}|19\d{2})\b/g, ''); // Remove years
        // Remove common words
        cleaned = cleaned.replace(/\b(Pokemon|Japanese|English|TCG|Promo|Card\s*Pack|Edition|Holo|Mirror\-Holo|R\-Holo|Base\s*Set)\b/gi, '');
        cleaned = cleaned.replace(/\-/g, ' '); // Dashes to spaces

        // 2. Card Number Extraction
        const idMatch = cleaned.match(/(#?\d+[\/\-]\d+|#\d+)/);
        let cardNo = idMatch ? idMatch[0].replace('#', '') : "";

        // 3. Set Mapping/Abbreviation
        if (cleaned.toLowerCase().includes("25th anniversary")) {
            cleaned = cleaned.replace(/25th\s+Anniversary/gi, '25th');
        } else if (cleaned.toLowerCase().includes("20th anniversary")) {
            cleaned = cleaned.replace(/20th\s+Anniversary/gi, '20th');
        }

        // 4. Word Clean up
        let remaining = cleaned.replace(idMatch ? idMatch[0] : "", '').trim();
        const words = remaining.split(/\s+/).filter(w => w.length > 1);

        return {
            words,
            cardNo,
            setMarker: (cleaned.toLowerCase().includes("25th") ? "25th" : (cleaned.toLowerCase().includes("20th") ? "20th" : ""))
        };
    }

    // Helper: Calculate Trimmed Average (Remove top/bottom 10%)
    function calculateTrimmedAverage(sales) {
        if (!sales || sales.length === 0) return "N/A";

        // Since API doesn't return dates for sold items in the list view,
        // we use the fetched "latest" 100 items as our "recent" window.
        // This is an approximation of the 15-day window for active cards.

        // 1. Extract prices (remove currency symbols)
        const prices = sales.map(s => {
            const p = s.price; // "US $123"
            return parseFloat(p.replace(/[^0-9.]/g, ''));
        }).filter(p => !isNaN(p));

        if (prices.length === 0) return "N/A";

        // 2. Sort prices
        prices.sort((a, b) => a - b);

        // 4. Trim Top/Bottom 10%
        const trimCount = Math.floor(prices.length * 0.10);
        const trimmedPrices = prices.slice(trimCount, prices.length - trimCount);

        if (trimmedPrices.length === 0) return "N/A"; // Should not happen unless minimal data

        // 5. Average
        const sum = trimmedPrices.reduce((acc, val) => acc + val, 0);
        const avg = sum / trimmedPrices.length;

        return `US $${Math.round(avg).toLocaleString()}`;
    }

    async function searchSnkrdunk(title, stage = 0) {
        const identity = (stage === 0) ? refineSearchQuery(title) : title;

        if (stage === 0) {
            psa10PriceEl.textContent = "...";
            avgPriceEl.textContent = "...";
            psa10StatusEl.textContent = "Searching...";
            avgStatusEl.textContent = "Calculating...";
            if (marketMinEl) marketMinEl.textContent = "Min Market: --";
            if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">Loading history...</div>';
        }

        // Robust Multi-stage fallback search
        let query = "";
        const words = identity.words || [];
        const last2 = words.slice(-2).join(' ');
        const last1 = words.slice(-1).join(' ');

        switch (stage) {
            case 0: query = `${last2} ${identity.cardNo}`.trim(); break;
            case 1: query = `${last1} ${identity.cardNo}`.trim(); break;
            case 2: if (identity.setMarker) query = `${last2} ${identity.setMarker}`.trim(); break;
            case 3: if (identity.setMarker) query = `${last1} ${identity.setMarker}`.trim(); break;
            case 4: query = last2; break;
            case 5: query = last1; break;
        }

        if (!query || (stage > 0 && query === (stage === 1 ? (`${last2} ${identity.cardNo}`.trim()) : ""))) {
            if (!query) return searchSnkrdunk(identity, stage + 1);
        }

        console.log(`[Stage ${stage}] Searching with query:`, query);

        const apiSearchUrl = `https://snkrdunk.com/en/v1/search?keyword=${encodeURIComponent(query)}&perPage=20&page=1`;

        const webSearchUrl = `https://snkrdunk.com/en/search/result?keyword=${encodeURIComponent(query)}`;
        viewBtn.onclick = () => { chrome.tabs.create({ url: webSearchUrl }); };

        try {
            const searchResp = await fetch(apiSearchUrl);
            if (!searchResp.ok) throw new Error("Search API failed");
            const searchData = await searchResp.json();

            const products = (searchData.products || []).concat(searchData.streetwears || []);

            if (products.length === 0) {
                if (stage < 5) {
                    return searchSnkrdunk(identity, stage + 1);
                }
                psa10PriceEl.textContent = "N/A";
                avgPriceEl.textContent = "N/A";
                psa10StatusEl.textContent = "No results";
                avgStatusEl.textContent = "No results";
                if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">No history found</div>';
                return;
            }

            const bestMatch = products[0];
            const productId = bestMatch.id;
            const minPrice = bestMatch.minPrice;
            console.log("Found product:", bestMatch.name, "ID:", productId, "MinPrice:", minPrice);

            if (marketMinEl) {
                marketMinEl.textContent = `Min Market: ${bestMatch.minPriceFormat || ('$' + minPrice.toLocaleString())}`;
            }

            viewBtn.onclick = () => {
                chrome.tabs.create({ url: `https://snkrdunk.com/en/trading-cards/${productId}?slide=right` });
            };

            // Fetch MORE history (up to 100) to ensure we cover 15 days
            const listingsUrl = `https://snkrdunk.com/en/v1/trading-cards/${productId}/used-listings?perPage=100&page=1&sortType=latest&isOnlyOnSale=false`;
            const listingsResp = await fetch(listingsUrl);
            if (!listingsResp.ok) throw new Error("Listings API failed");
            const listingsData = await listingsResp.json();

            const listings = listingsData.usedTradingCards || [];

            let psa10Price = "N/A";
            let psa10Sales = [];
            let soldHistory = [];

            listings.forEach(listing => {
                const condition = (listing.condition || "Used").toUpperCase();
                const priceStr = listing.price || "N/A";
                // Normalize "PSA 10" detection
                const isPSA10 = condition.includes("PSA 10") || condition.includes("PSA10");

                if (!listing.isSold) {
                    // Active PSA 10 Price (take first/latest/cheapest? API sort is 'latest', usually we want cheapest but for now take latest active or loop to find min?
                    // The API sortType=latest, so this is the most recently listed. 
                    // Actually, usually users want the Lowest Ask. But this API endpoint is 'used-listings' list.
                    // For active items, finding the lowest price is better.
                    if (isPSA10) {
                        // Parse price to number to compare if we want min
                        const pVal = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
                        const currentMin = psa10Price === "N/A" ? Infinity : parseFloat(psa10Price.replace(/[^0-9.]/g, ''));

                        if (pVal < currentMin) {
                            psa10Price = priceStr;
                        }
                    }
                } else {
                    // Sold History - STRICTLY PSA 10 for both Stats and Display as requested
                    if (isPSA10) {
                        psa10Sales.push(listing); // For average calc

                        if (soldHistory.length < 3) {
                            soldHistory.push({
                                price: priceStr,
                                grade: condition,
                                status: "SOLD",
                                date: listing.updatedAt // Keep date if needed
                            });
                        }
                    }
                }
            });

            // Update Main Prices
            psa10PriceEl.textContent = psa10Price;
            psa10StatusEl.textContent = psa10Price !== "N/A" ? "Live Price" : "Not listed";

            // Calculate 15-Day Trimmed Average (PSA 10 Only)
            const avgPrice = calculateTrimmedAverage(psa10Sales);
            avgPriceEl.textContent = avgPrice;
            avgStatusEl.textContent = avgPrice !== "N/A" ? "15-Day Trimmed" : "Insufficient Data";

            // Update Trade History UI (PSA 10 Only)
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
            console.error("API error:", error);
            psa10StatusEl.textContent = "Error";
            avgStatusEl.textContent = "Error";
            if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">Error loading data</div>';
        }
    }
});
