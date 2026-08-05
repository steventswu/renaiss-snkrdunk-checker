const WEB_PAGE_PATTERN = /^https?:\/\//;

chrome.action.onClicked.addListener(async (tab) => {
  // `activeTab` grants temporary access after this user gesture. Card pages
  // load their data automatically; every other web page opens search mode.
  if (!tab.id || !WEB_PAGE_PATTERN.test(tab.url || '')) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-bridge.js'], world: 'MAIN' });
    await chrome.tabs.sendMessage(tab.id, { action: 'toggleModal', cardUrl: tab.url });
  } catch (error) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-bridge.js'], world: 'MAIN' });
    await chrome.tabs.sendMessage(tab.id, { action: 'toggleModal', cardUrl: tab.url });
  }
});
