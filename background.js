chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https?:\/\//.test(tab.url || '')) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['modal-launcher.js'] });
});
