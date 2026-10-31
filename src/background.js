import { transferPrefix } from './workspace-transfer.js';
import { handleWorkspaceMessage } from './workspace-store.js';
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'image-port:toggle' });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  }
});

// Persist transfer chunks in the service worker's own IndexedDB origin. This
// avoids iframe storage partitioning and survives service worker suspension.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (typeof message?.type !== 'string' || !message.type.startsWith(transferPrefix)) return;
  handleWorkspaceMessage(message, sender).then(result => reply({ ok: true, ...result }),
    error => reply({ ok: false, error: error.message || '无法保存工作内容，原悬浮窗仍保留全部图片' }));
  return true;
});
