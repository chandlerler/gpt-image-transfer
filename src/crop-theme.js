/* 尽早应用已保存主题，避免刷新闪烁；默认浅色 */
  try { if (localStorage.getItem('iz-theme') === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); } catch (e) {}
