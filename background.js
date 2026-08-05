const CARD_PAGE_PATTERN = /^https:\/\/(?:www\.)?renaiss\.xyz\/card\/|^https:\/\/index\.renaissos\.com\/card\//;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !CARD_PAGE_PATTERN.test(tab.url || '')) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'toggleModal' });
  } catch (error) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { action: 'toggleModal' });
  }
});
