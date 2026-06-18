# ChatGPT Markdown Exporter

一个用于批量导出 ChatGPT 网页对话为 Markdown 文件的 Manifest V3 浏览器扩展。

## 功能

- 从 ChatGPT 网页接口读取账号下的历史会话列表。
- 在插件弹窗中查看、筛选、勾选多个会话。
- 批量抓取所选会话详情并转换为 Markdown。
- 将多个 Markdown 文件打包为一个 `.zip` 下载。
- 会话列表、选择状态和导出进度保存在后台，关闭弹窗后再次打开仍可恢复。

## 本地加载

1. 打开 Chrome 或 Chromium 的扩展管理页。
2. 启用开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录 `chatgpt-markdown-exporter`。
5. 打开任意 ChatGPT 页面并保持登录，再点击插件图标读取会话列表。

## 打包 CRX

仓库根目录下运行：

```bash
google-chrome --pack-extension=chatgpt-markdown-exporter
```

命令会生成 `chatgpt-markdown-exporter.crx` 和 `chatgpt-markdown-exporter.pem`。
其中 `.crx` 是可安装交付物，`.pem` 是本地打包私钥，默认不提交到仓库。
