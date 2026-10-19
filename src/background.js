chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'image-port:toggle' });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  }
});
