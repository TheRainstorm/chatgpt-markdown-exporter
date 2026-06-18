# ChatGPT Markdown Exporter

一个用于批量导出 ChatGPT 网页对话为 Markdown 文件的 Manifest V3 浏览器扩展。

## 功能

- 从 ChatGPT 网页接口读取账号下的历史会话列表。
- 在插件弹窗中查看、筛选、勾选多个会话。
- 批量抓取所选会话详情并转换为 Markdown。
- 将多个 Markdown 文件打包为一个 `.zip` 下载。
- 会话列表、选择状态和导出进度保存在后台，关闭弹窗后再次打开仍可恢复。

## 本地加载

1. 从 GitHub Release 下载 `chatgpt-markdown-exporter-v*.zip`，并解压到本地目录。
2. 打开 Chrome、Edge 或其他 Chromium 浏览器的扩展管理页。
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. 启用开发者模式。
4. 选择“加载已解压的扩展程序”。
5. 选择解压后的目录。该目录里应直接包含 `manifest.json`。
6. 打开任意 ChatGPT 页面并保持登录，再点击插件图标读取会话列表。

> 说明：面向普通用户分发时，不建议再把 `.crx` 作为主要安装包。Chrome/Chromium 对非商店 CRX 安装有限制；开发、测试或 GitHub 分发场景下，更通用的方式是下载 zip、解压后加载已解压扩展。

## 本地开发加载

1. 打开 Chrome、Edge 或其他 Chromium 浏览器的扩展管理页。
2. 启用开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录 `chatgpt-markdown-exporter`。
5. 打开任意 ChatGPT 页面并保持登录，再点击插件图标读取会话列表。

## 打包 ZIP

仓库根目录下运行：

```bash
bash scripts/package-extension.sh
```

命令会读取 `chatgpt-markdown-exporter/manifest.json` 里的版本号，并生成：

```text
dist/chatgpt-markdown-exporter-v<version>.zip
```

## 自动发布 Release

推送版本标签会触发 GitHub Actions 自动打包并发布 Release：

```bash
git tag v0.3.0
git push origin v0.3.0
```

工作流会上传 `dist/chatgpt-markdown-exporter-v<version>.zip` 作为 Release 附件。
