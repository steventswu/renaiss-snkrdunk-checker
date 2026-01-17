// popup.js
document.addEventListener('DOMContentLoaded', async () => {
    const cardNameEl = document.getElementById('cardName');
    const psa10PriceEl = document.getElementById('psa10-price');
    const gradeAPriceEl = document.getElementById('gradeA-price');
    const psa10StatusEl = document.getElementById('psa10-status');
    const gradeAStatusEl = document.getElementById('gradeA-status');
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
            gradeAStatusEl.textContent = "Waiting for page...";
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
            gradeAStatusEl.textContent = "Extension link pending";
        } else {
            cardNameEl.textContent = "Error detecting card";
        }
    }

    function refineSearchQuery(title) {
        console.log("Original Title:", title);

        // 1. Noise Stripping: Remove grading junk, years, and generic TCG words
        let cleaned = title.replace(/^(PSA\s*\d+|Gem\s*Mint|Mint|NM|Near\s*Mint|Excellent|Grader\s*PSA)\s+/gi, '');
        cleaned = cleaned.replace(/\b(20\d{2}|19\d{2})\b/g, ''); // Remove years
        // Remove common words but keep set codes like 151, Sv2a if possible? Actually remove generic words.
        cleaned = cleaned.replace(/\b(Pokemon|Japanese|English|TCG|Promo|Card\s*Pack|Edition|Holo|Mirror\-Holo|R\-Holo|Base\s*Set)\b/gi, '');
        cleaned = cleaned.replace(/\-/g, ' '); // Dashes to spaces

        // 2. Card Number Extraction: Prioritize finding the exact card ID
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

    async function searchSnkrdunk(title, stage = 0) {
        const identity = (stage === 0) ? refineSearchQuery(title) : title;

        if (stage === 0) {
            psa10PriceEl.textContent = "...";
            gradeAPriceEl.textContent = "...";
            psa10StatusEl.textContent = "Searching...";
            gradeAStatusEl.textContent = "Searching...";
            if (marketMinEl) marketMinEl.textContent = "Min Market: --";
            if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">Loading history...</div>';
        }

        // Robust Multi-stage fallback search
        let query = "";
        const words = identity.words || [];
        const last2 = words.slice(-2).join(' ');
        const last1 = words.slice(-1).join(' ');

        switch (stage) {
            case 0: // Try Last 2 words + ID (e.g. "Dark Magician 046")
                query = `${last2} ${identity.cardNo}`.trim();
                break;
            case 1: // Try Last 1 word + ID (e.g. "Magmar 126" - fixes Sv2a 151 issue)
                query = `${last1} ${identity.cardNo}`.trim();
                break;
            case 2: // Try Last 2 words + Set (e.g. "Blastoise 25th")
                if (identity.setMarker) query = `${last2} ${identity.setMarker}`.trim();
                break;
            case 3: // Try Last 1 word + Set
                if (identity.setMarker) query = `${last1} ${identity.setMarker}`.trim();
                break;
            case 4: // Try Last 2 words only
                query = last2;
                break;
            case 5: // Try Last 1 word only
                query = last1;
                break;
        }

        // Optimization: Skip empty queries or duplicates
        if (!query || (stage > 0 && query === (stage === 1 ? (`${last2} ${identity.cardNo}`.trim()) : ""))) {
            // Logic to skip efficiently? simplified: just recurse if empty/duplicate
            // For simplicity, just check if query is empty
            if (!query) return searchSnkrdunk(identity, stage + 1);
        }

        console.log(`[Stage ${stage}] Searching with query:`, query);

        const apiSearchUrl = `https://snkrdunk.com/en/v1/search?keyword=${encodeURIComponent(query)}&perPage=20&page=1`;

        // Update view button to point to the search page (web UI)
        const webSearchUrl = `https://snkrdunk.com/en/search/result?keyword=${encodeURIComponent(query)}`;
        viewBtn.onclick = () => { chrome.tabs.create({ url: webSearchUrl }); };

        try {
            const searchResp = await fetch(apiSearchUrl);
            if (!searchResp.ok) throw new Error("Search API failed");
            const searchData = await searchResp.json();

            // SNKRDUNK search results can be in 'products' or 'streetwears'
            const products = (searchData.products || []).concat(searchData.streetwears || []);

            if (products.length === 0) {
                if (stage < 5) {
                    return searchSnkrdunk(identity, stage + 1);
                }
                psa10PriceEl.textContent = "N/A";
                gradeAPriceEl.textContent = "N/A";
                psa10StatusEl.textContent = "No results";
                gradeAStatusEl.textContent = "No results";
                if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">No history found</div>';
                return;
            }

            // Pick the first product as the best match
            const bestMatch = products[0];
            const productId = bestMatch.id;
            const minPrice = bestMatch.minPrice;
            console.log("Found product:", bestMatch.name, "ID:", productId, "MinPrice:", minPrice);

            // Update UI with Min Market Price
            if (marketMinEl) {
                marketMinEl.textContent = `Min Market: ${bestMatch.minPriceFormat || ('$' + minPrice.toLocaleString())}`;
            }

            // Update view button to the specific product page
            viewBtn.onclick = () => {
                chrome.tabs.create({ url: `https://snkrdunk.com/en/trading-cards/${productId}?slide=right` });
            };

            // Now fetch the used listings (including sold) for this product
            const listingsUrl = `https://snkrdunk.com/en/v1/trading-cards/${productId}/used-listings?perPage=50&page=1&sortType=latest&isOnlyOnSale=false`;
            const listingsResp = await fetch(listingsUrl);
            if (!listingsResp.ok) throw new Error("Listings API failed");
            const listingsData = await listingsResp.json();

            // The correct field name is usedTradingCards
            const listings = listingsData.usedTradingCards || [];

            let psa10Price = "N/A";
            let gradeAPrice = "N/A";
            let soldHistory = [];

            listings.forEach(listing => {
                const condition = (listing.condition || "Used").toUpperCase();
                // SNKRDUNK API for used items returns formatted string like "US $48"
                const priceStr = listing.price || "N/A";

                if (!listing.isSold) {
                    // Extract active PSA 10 / Grade A prices
                    if (condition.includes("PSA 10") && psa10Price === "N/A") {
                        psa10Price = priceStr;
                    } else if ((condition.includes("GRADE A") || condition === "A" || condition.includes("MINT")) && gradeAPrice === "N/A") {
                        if (!condition.includes("PSA 10")) {
                            gradeAPrice = priceStr;
                        }
                    }
                } else {
                    // Collect sold items for history
                    if (soldHistory.length < 3) {
                        soldHistory.push({
                            price: priceStr,
                            grade: condition,
                            status: "SOLD"
                        });
                    }
                }
            });

            // Update Main Prices
            psa10PriceEl.textContent = psa10Price;
            gradeAPriceEl.textContent = gradeAPrice;
            psa10StatusEl.textContent = psa10Price !== "N/A" ? "Live Price" : "Not listed";
            gradeAStatusEl.textContent = gradeAPrice !== "N/A" ? "Live Price" : "Not listed";

            // Update Trade History UI
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
                    historyListEl.innerHTML = '<div class="history-item loading">No recent trades</div>';
                }
            }

        } catch (error) {
            console.error("API error:", error);
            psa10StatusEl.textContent = "Error";
            gradeAStatusEl.textContent = "Error";
            if (historyListEl) historyListEl.innerHTML = '<div class="history-item loading">Error loading data</div>';
        }
    }
});
