const enabled = document.getElementById('launcher-enabled');
const status = document.getElementById('status');
const openPage = document.getElementById('open-page');
const openPanel = document.getElementById('open-panel');
let revision = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.launcherEnabled) {
    revision++;
    enabled.checked = changes.launcherEnabled.newValue !== false;
  }
});
const initialRevision = revision;
chrome.storage.local.get({ launcherEnabled: true }).then(settings => {
  if (revision === initialRevision) enabled.checked = settings.launcherEnabled !== false;
  enabled.disabled = false;
}).catch(() => { status.textContent = '无法读取悬浮球设置，请关闭菜单后重试。'; });
enabled.addEventListener('change', async () => {
  const desired = enabled.checked;
  enabled.disabled = true; status.textContent = '';
  try { await chrome.storage.local.set({ launcherEnabled: desired }); }
  catch { enabled.checked = !desired; status.textContent = '设置保存失败，请重试。'; }
  finally { enabled.disabled = false; }
});
openPage.addEventListener('click', async () => {
  openPage.disabled = true; status.textContent = '';
  try { await chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); window.close(); }
  catch { status.textContent = '无法打开工具网页，请重试。'; openPage.disabled = false; }
});
openPanel.addEventListener('click', async () => {
  openPanel.disabled = true; status.textContent = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no-tab');
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'image-port:open-panel' });
    if (!result?.ok) throw new Error('no-content-script');
    await chrome.storage.local.set({ launcherEnabled: true });
    window.close();
  } catch {
    status.textContent = '此页面暂不能打开悬浮窗。请刷新普通网页重试，或点击“打开工具网页”。';
    openPanel.disabled = false;
  }
});
