const STORAGE_KEY = "chatgptMarkdownExporterState";

const appState = {
  conversations: [],
  selectedIds: [],
  status: "请先打开任意 ChatGPT 页面并保持登录。",
  loading: false,
  exporting: false,
  exportProgress: null,
  lastScan: null,
  lastUpdatedAt: null
};

let saveTimer = null;

initializeState();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "get-exporter-state") {
    sendResponse({ ok: true, state: getPublicState() });
    return false;
  }

  if (message?.type === "load-conversations") {
    loadConversations().then(sendResponse);
    return true;
  }

  if (message?.type === "set-selected-conversations") {
    setSelectedIds(message.selectedIds);
    sendResponse({ ok: true, state: getPublicState() });
    return false;
  }

  if (message?.type === "start-export") {
    startExport().then(sendResponse);
    return true;
  }

  if (message?.type === "download-markdown") {
    downloadMarkdown(message, sendResponse);
    return true;
  }

  if (message?.type === "download-zip") {
    downloadZip(message, sendResponse);
    return true;
  }

  return false;
});

async function initializeState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const next = stored[STORAGE_KEY];

  if (next && typeof next === "object") {
    Object.assign(appState, {
      ...next,
      loading: false,
      exporting: false,
      exportProgress: next.exportProgress?.done ? next.exportProgress : null
    });
  }
}

async function loadConversations() {
  if (appState.loading) {
    return { ok: true, state: getPublicState() };
  }

  try {
    appState.loading = true;
    appState.status = "正在读取 ChatGPT 历史会话...";
    touchState();

    const tab = await getChatGptTab();
    const response = await sendMessageToTab(tab.id, {
      type: "list-chatgpt-conversations",
      limit: 28
    });

    if (!response?.ok) {
      throw new Error(response?.error || "读取会话列表失败。");
    }

    const existingSelection = new Set(appState.selectedIds);
    const availableIds = new Set(response.conversations.map((conversation) => conversation.id));

    appState.conversations = response.conversations;
    appState.selectedIds = Array.from(existingSelection).filter((id) => availableIds.has(id));
    appState.lastScan = response.scan || null;
    appState.status = formatLoadStatus(response);
    appState.exportProgress = null;
    touchState();

    return { ok: true, state: getPublicState() };
  } catch (error) {
    appState.status = error?.message || "读取失败。";
    touchState();
    return { ok: false, error: appState.status, state: getPublicState() };
  } finally {
    appState.loading = false;
    touchState();
  }
}

function setSelectedIds(selectedIds) {
  const availableIds = new Set(appState.conversations.map((conversation) => conversation.id));
  appState.selectedIds = Array.isArray(selectedIds)
    ? selectedIds.filter((id) => availableIds.has(id))
    : [];
  touchState();
}

async function startExport() {
  if (appState.exporting) {
    return { ok: true, state: getPublicState() };
  }

  const selectedIds = new Set(appState.selectedIds);
  const selected = appState.conversations.filter((conversation) => selectedIds.has(conversation.id));

  if (selected.length === 0) {
    appState.status = "请先选择至少一个会话。";
    touchState();
    return { ok: false, error: appState.status, state: getPublicState() };
  }

  appState.exporting = true;
  appState.exportProgress = {
    current: 0,
    total: selected.length,
    title: "",
    done: false
  };
  touchState();

  await runExportTask(selected);
  return { ok: true, state: getPublicState() };
}

async function runExportTask(selected) {
  try {
    const tab = await getChatGptTab();
    const files = [];

    for (let index = 0; index < selected.length; index += 1) {
      const conversation = selected[index];
      appState.exportProgress = {
        current: index + 1,
        total: selected.length,
        title: conversation.title,
        done: false
      };
      appState.status = `正在导出 ${index + 1}/${selected.length}: ${conversation.title}`;
      touchState();

      const response = await sendMessageToTab(tab.id, {
        type: "export-chatgpt-conversation-by-id",
        conversationId: conversation.id
      });

      if (!response?.ok) {
        throw new Error(response?.error || `导出失败: ${conversation.title}`);
      }

      files.push({
        filename: response.filename,
        content: response.markdown
      });
    }

    await downloadZipAsync({
      filename: `chatgpt-conversations-${formatDateTime(new Date())}.zip`,
      files
    });

    appState.status = `已创建下载任务，共 ${files.length} 个 Markdown 文件。`;
    appState.exportProgress = {
      current: selected.length,
      total: selected.length,
      title: "",
      done: true
    };
  } catch (error) {
    appState.status = error?.message || "导出失败。";
  } finally {
    appState.exporting = false;
    touchState();
  }
}

async function getChatGptTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (activeTab?.id && isChatGptUrl(activeTab.url)) {
    return activeTab;
  }

  const [existingTab] = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });

  if (existingTab?.id) {
    return existingTab;
  }

  throw new Error("请先打开任意 ChatGPT 页面并保持登录。");
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        injectContentScript(tabId)
          .then(() => {
            chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
              if (chrome.runtime.lastError) {
                reject(new Error("无法连接 ChatGPT 页面，请刷新页面后重试。"));
                return;
              }

              resolve(retryResponse);
            });
          })
          .catch(() => reject(new Error("无法连接 ChatGPT 页面，请刷新页面后重试。")));
        return;
      }

      resolve(response);
    });
  });
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["scripts/content.js"]
  });
}

function isChatGptUrl(url = "") {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url);
}

function getPublicState() {
  return {
    conversations: appState.conversations,
    selectedIds: appState.selectedIds,
    status: appState.status,
    loading: appState.loading,
    exporting: appState.exporting,
    exportProgress: appState.exportProgress,
    lastScan: appState.lastScan,
    lastUpdatedAt: appState.lastUpdatedAt
  };
}

function touchState() {
  appState.lastUpdatedAt = new Date().toISOString();
  scheduleSaveState();
}

function scheduleSaveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ [STORAGE_KEY]: getPublicState() });
  }, 150);
}

function formatLoadStatus(response) {
  const count = response.conversations?.length || 0;

  if (count > 0) {
    return `已读取 ${count} 个会话。`;
  }

  const standard = response.scan?.standard;
  const archived = response.scan?.archived;

  if (!standard && !archived) {
    return "没有读取到会话。";
  }

  return [
    "没有读取到会话。",
    `普通: ${standard?.count ?? 0} (${standard?.reason || "无详情"})`,
    `归档: ${archived?.count ?? 0} (${archived?.reason || "无详情"})`
  ].join(" ");
}

function downloadMarkdown(message, sendResponse) {
  const markdown = typeof message.markdown === "string" ? message.markdown : "";
  const filename = normalizeMarkdownFilename(message.filename || "chatgpt-conversation.md");
  const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`;

  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: true,
      conflictAction: "uniquify"
    },
    (downloadId) => respondDownload(sendResponse, downloadId)
  );
}

function downloadZip(message, sendResponse) {
  downloadZipAsync(message)
    .then((downloadId) => sendResponse({ ok: true, downloadId }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "ZIP 打包失败。" }));
}

async function downloadZipAsync(message) {
  const files = Array.isArray(message.files) ? message.files : [];

  if (files.length === 0) {
    throw new Error("没有可下载的文件。");
  }

  const zipBytes = createStoredZip(files.map((file) => ({
    filename: normalizeMarkdownFilename(file.filename || "chatgpt-conversation.md"),
    content: typeof file.content === "string" ? file.content : ""
  })));
  const url = `data:application/zip;base64,${uint8ToBase64(zipBytes)}`;
  const filename = normalizeZipFilename(message.filename || "chatgpt-conversations.zip");

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: true,
        conflictAction: "uniquify"
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(downloadId);
      }
    );
  });
}

function respondDownload(sendResponse, downloadId) {
  if (chrome.runtime.lastError) {
    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
    return;
  }

  sendResponse({ ok: true, downloadId });
}

function normalizeMarkdownFilename(filename) {
  const cleaned = cleanFilename(filename);
  return cleaned.endsWith(".md") ? cleaned : `${cleaned || "chatgpt-conversation"}.md`;
}

function normalizeZipFilename(filename) {
  const cleaned = cleanFilename(filename);
  return cleaned.endsWith(".zip") ? cleaned : `${cleaned || "chatgpt-conversations"}.zip`;
}

function cleanFilename(filename) {
  return String(filename)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function createStoredZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const filenameBytes = encoder.encode(file.filename);
    const contentBytes = encoder.encode(file.content);
    const crc = crc32(contentBytes);
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, contentBytes.length, true);
    localView.setUint32(22, contentBytes.length, true);
    localView.setUint16(26, filenameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(filenameBytes, 30);
    localParts.push(localHeader, contentBytes);

    const centralHeader = new Uint8Array(46 + filenameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, contentBytes.length, true);
    centralView.setUint32(24, contentBytes.length, true);
    centralView.setUint16(28, filenameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(filenameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + contentBytes.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

function concatUint8Arrays(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;

  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "-" + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
}
