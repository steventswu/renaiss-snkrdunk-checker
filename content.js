// content.js
console.log("SNKRDUNK Price Checker: Content script loaded.");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCardTitle") {
    const titleText = findCardTitle();
    if (titleText) {
      sendResponse({ title: titleText });
    } else {
      sendResponse({ error: "Title not found" });
    }
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
    '[class*="text-2xl"][class*="font-bold"]'
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
