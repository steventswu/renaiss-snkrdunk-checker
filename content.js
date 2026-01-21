// content.js
console.log("SNKRDUNK Price Checker: Content script loaded.");
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCardTitle") {
    // Selector based on research: h1.text-2xl.font-bold on marketplace pages
    const candidates = [
      'h1',
      'span.text-2xl.font-semibold.text-white',
      '.text-2xl.font-semibold',
      '[class*="text-2xl"][class*="font-bold"]'
    ];

    let titleText = "";
    for (const selector of candidates) {
      const elements = Array.from(document.querySelectorAll(selector));
      // Find the first visible one
      const visible = elements.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
      });

      if (visible) {
        titleText = visible.textContent.trim();
        break;
      }
    }

    if (titleText) {
      sendResponse({ title: titleText });
    } else {
      sendResponse({ error: "Title not found" });
    }
  }
  return true;
});
