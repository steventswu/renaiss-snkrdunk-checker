// content.js
console.log("SNKRDUNK Price Checker: Content script loaded.");
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCardTitle") {
    // Selector based on research: h1.text-2xl.font-bold on marketplace pages
    const titleElement = document.querySelector('h1') ||
      document.querySelector('span.text-2xl.font-semibold.text-white') ||
      document.querySelector('.text-2xl.font-semibold') ||
      document.querySelector('[class*="text-2xl"][class*="font-bold"]');

    if (titleElement) {
      const title = titleElement.textContent.trim();
      // Clean up title if it contains "PSA 10 Gem Mint" etc for better SNKRDUNK search
      // But let's send the full title and let popup.js handle the search refinement
      sendResponse({ title: title });
    } else {
      sendResponse({ error: "Title not found" });
    }
  }
  return true;
});
