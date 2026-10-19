# 图像港 Image Port

一个 Manifest V3 Chrome 扩展。通过网页右下角的悬浮按钮，在本地批量转换图片、重命名和下载，无需账号或后端服务。

## 安装

1. [下载插件安装包 ZIP](https://github.com/chandlerler/gpt-image-transfer/raw/refs/heads/main/releases/image-port-chrome.zip) 并解压（开发者也可以按下方命令构建，输出为 `artifacts/image-port-chrome.zip`）。
2. 打开 Chrome 的 `chrome://extensions`，启用右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后包含 `manifest.json` 的目录；本地开发选择 `dist/`。
4. 刷新已打开的普通网页，点击右下角「图片转换」。也可以点击浏览器工具栏里的扩展图标。

需要 Chrome / Chromium 120 或更新版本。Chrome 内部页面、Chrome 应用商店等受保护页面不能插入悬浮按钮，此时工具栏图标会打开独立转换页面。网页刷新会清空该网页面板的内存队列，长批次建议使用独立页面（扩展管理页查看扩展 ID，地址为 `chrome-extension://扩展ID/app.html`）。

## 使用

- 拖入图片或选择多个文件，可混合不同输入格式，并分次追加文件。
- 选择 PNG、JPG、WebP、GIF、BMP、TIFF 或 ICO 作为统一输出格式。
- JPG / WebP 可设置质量；JPG、BMP、GIF 可指定透明区域的填充颜色。
- 批量重命名模板支持 `{name}`（原文件名）和 `{n}`（序号）。例如 `旅行_{n}`，起始序号 1、位数 3，会生成 `旅行_001.png`。默认保留原名；不合法字符会被替换，同名自动加后缀，避免覆盖。
- 可填写最大宽高，保持比例，只缩小不放大。ICO 自动限制到 256 × 256。
- 点击「开始转换」，查看每个文件的成功或失败状态；支持停止后续处理。
- 点击单个文件右侧下载按钮，或「打包下载 ZIP」。失败项不会阻止其他文件转换或下载。
- 转换后可以继续调整名称；修改格式、尺寸、质量或背景色则需要重新转换。

## 格式与容量边界

没有任何转换器能保证读取所有格式。本插件读取 Chrome 支持的图片格式（常见 JPG、PNG、WebP、GIF、SVG、AVIF、BMP、ICO），并使用 UTIF.js 补充 TIFF；具体输入仍受文件编码和浏览器能力影响。HEIC / HEIF、相机 RAW、PSD 等不支持的文件会显示失败原因，不会伪装成转换成功。

动画 GIF / WebP 等输出为静态图片；TIFF 仅读取第一页。GIF 输出最多 256 色，并使用指定颜色填充透明区域。SVG 可栅格化导入，不提供矢量导出。PNG、WebP、TIFF 和 ICO 输出保留透明背景，转换不保留 EXIF、GPS 等原始元数据。

队列没有人为的文件数量上限，逐张解码和转换以降低峰值内存。但文件及结果仍保存在内存中，实际容量受设备和浏览器限制；单图上限为 8000 万像素、单边 32767 像素。大批次 ZIP 会在约 512 MB 或 10000 个条目处分包；单个输出超过 2 GB 时请单独下载或缩小尺寸。浏览器可能要求允许多个下载。关闭面板保留当前页面队列，刷新页面或关闭标签页后清空。

## 本地开发

环境：Node.js 20+、npm；浏览器端到端测试使用 Chromium。

```bash
npm ci
npm run build
npm test
npm run test:e2e
# 在允许加载开发者扩展的 Chromium 环境中运行实际安装测试
npm run test:extension
# 一次运行全部检查
npm run check
```

`npm run build` 生成 `dist/` 和 `artifacts/image-port-chrome.zip`。构建内容包括离线 JS 依赖、图标和第三方许可证，不需要 CDN。端到端测试默认读取 `/usr/bin/chromium`，其他环境使用 `CHROMIUM_PATH=/absolute/path/to/chromium npm run test:e2e`。

默认端到端测试在真实 Chromium 中通过本地测试服务器运行转换页，并模拟扩展 runtime API 来测试悬浮窗，检查七种编码的文件头、尺寸、像素、透明度、相互转换、损坏文件隔离、重命名、ZIP 和单独下载、移动宽度布局以及悬浮交互。测试截图在 `artifacts/` 下。

`npm run test:extension` 使用同一套用例，以实际已加载扩展的方式运行，不模拟 runtime API。当前云环境设置了 `ExtensionInstallBlocklist: ["*"]` 管理策略，阻止实际安装测试；因此本环境的功能测试不能替代用户 Chrome 上的加载验证。

## 隐私与权限

扩展没有服务器、统计代码或图片上传逻辑；转换页 CSP 禁止网络连接。网页匹配范围用于显示悬浮入口。内容脚本只创建隔离面板，不读取网页文本或图片；只有用户主动选取的文件会被处理。没有请求下载管理、浏览历史、剪贴板等权限，下载通过浏览器的文件下载机制完成。

## 代码结构

- `src/content.js`：网页悬浮入口与隔离 iframe。
- `src/background.js`：工具栏点击与受保护页面的独立页面回退。
- `src/app.*`：队列、设置、进度、下载与中文界面。
- `src/convert.js`：浏览器解码、Canvas 与各格式编码。
- `src/core.js`：命名、尺寸和二进制文件编码。
- `scripts/build.mjs`：离线打包、图标生成和分发 ZIP。

本项目尚未发布到 Chrome 应用商店。
