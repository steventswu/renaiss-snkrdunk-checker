const https = require('https');

function fetchJson(url) {
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    };
    return new Promise((resolve, reject) => {
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    console.error("Parse Error:", data.substring(0, 100));
                    resolve({});
                }
            });
        }).on('error', reject);
    });
}

async function run() {
    // 1. Search for a product
    console.log("Searching for Pikachu...");
    const searchUrl = "https://snkrdunk.com/en/v1/products/search?keyword=Pikachu&perPage=1";
    const searchData = await fetchJson(searchUrl);

    if (!searchData.products || searchData.products.length === 0) {
        console.log("No products found.");
        return;
    }

    const firstProduct = searchData.products[0];
    const productId = firstProduct.id;
    console.log(`Found Product ID: ${productId} (${firstProduct.name})`);

    // 2. Fetch trading histories
    // Using 100 per page to see if we get enough history
    const historyUrl = `https://snkrdunk.com/en/v1/streetwears/${productId}/trading-histories?perPage=20&page=1`;
    console.log(`Fetching history from: ${historyUrl}`);
    const historyData = await fetchJson(historyUrl);

    if (historyData.history && historyData.history.length > 0) {
        console.log("History Sample (First Item):");
        const h = historyData.history[0];
        console.log(JSON.stringify(h, null, 2));

        console.log("History Key Check:");
        // check for condition
        const specificKeys = ['price', 'date', 'updatedAt', 'createdAt', 'condition', 'status'];
        specificKeys.forEach(k => console.log(`${k}: ${h[k]}`));

    } else {
        console.log("No history found or unexpected format.");
        console.log("Keys:", Object.keys(historyData));
    }
}

run();
