const state = {
  conversations: [],
  selectedIds: new Set(),
  searchTerm: "",
  loading: false,
  exporting: false,
  status: "请先打开任意 ChatGPT 页面并保持登录。",
  exportProgress: null
};

const elements = {
  loadButton: document.getElementById("load-conversations"),
  selectAllButton: document.getElementById("select-all"),
  clearSelectionButton: document.getElementById("clear-selection"),
  exportButton: document.getElementById("export-selected"),
  searchInput: document.getElementById("search-input"),
  list: document.getElementById("conversation-list"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary-text")
};

elements.loadButton.addEventListener("click", loadConversations);
elements.selectAllButton.addEventListener("click", selectFilteredConversations);
elements.clearSelectionButton.addEventListener("click", clearSelection);
elements.exportButton.addEventListener("click", startExport);
elements.searchInput.addEventListener("input", () => {
  state.searchTerm = elements.searchInput.value.trim().toLowerCase();
  render();
});

hydrateState();
setInterval(hydrateState, 1000);

async function hydrateState() {
  const response = await chrome.runtime.sendMessage({ type: "get-exporter-state" });

  if (!response?.ok) {
    return;
  }

  applyBackgroundState(response.state);
}

async function loadConversations() {
  setStatus("正在读取 ChatGPT 历史会话...");
  setBusy({ loading: true });

  const response = await chrome.runtime.sendMessage({ type: "load-conversations" });
  if (response?.state) {
    applyBackgroundState(response.state);
  }
  if (!response?.ok && response?.error) {
    setStatus(response.error);
  }
}

async function startExport() {
  await syncSelectionToBackground();
  const response = await chrome.runtime.sendMessage({ type: "start-export" });

  if (response?.state) {
    applyBackgroundState(response.state);
  }
  if (!response?.ok && response?.error) {
    setStatus(response.error);
  }
}

async function syncSelectionToBackground() {
  const response = await chrome.runtime.sendMessage({
    type: "set-selected-conversations",
    selectedIds: Array.from(state.selectedIds)
  });

  if (response?.state) {
    applyBackgroundState(response.state, { preserveSearch: true });
  }
}

function applyBackgroundState(nextState, options = {}) {
  state.conversations = Array.isArray(nextState?.conversations) ? nextState.conversations : [];
  state.selectedIds = new Set(Array.isArray(nextState?.selectedIds) ? nextState.selectedIds : []);
  state.loading = Boolean(nextState?.loading);
  state.exporting = Boolean(nextState?.exporting);
  state.status = nextState?.status || state.status;
  state.exportProgress = nextState?.exportProgress || null;

  if (!options.preserveSearch && elements.searchInput.value.trim() !== state.searchTerm) {
    state.searchTerm = elements.searchInput.value.trim().toLowerCase();
  }

  render();
}

function selectFilteredConversations() {
  getFilteredConversations().forEach((conversation) => state.selectedIds.add(conversation.id));
  syncSelectionToBackground();
  render();
}

function clearSelection() {
  state.selectedIds.clear();
  syncSelectionToBackground();
  render();
}

function render() {
  const filtered = getFilteredConversations();
  elements.list.innerHTML = "";

  if (filtered.length === 0) {
    elements.list.innerHTML = `<div class="empty">${state.conversations.length ? "没有匹配的会话" : "点击“读取会话列表”开始"}</div>`;
  } else {
    const fragment = document.createDocumentFragment();
    filtered.forEach((conversation) => fragment.appendChild(createConversationItem(conversation)));
    elements.list.appendChild(fragment);
  }

  const selectedCount = state.selectedIds.size;
  elements.summary.textContent = summaryText(filtered.length, selectedCount);
  elements.status.textContent = state.status;
  setBusy({ loading: state.loading, exporting: state.exporting });
}

function createConversationItem(conversation) {
  const label = document.createElement("label");
  label.className = "conversation-item";
  label.setAttribute("role", "listitem");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedIds.has(conversation.id);
  checkbox.disabled = state.loading || state.exporting;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      state.selectedIds.add(conversation.id);
    } else {
      state.selectedIds.delete(conversation.id);
    }

    syncSelectionToBackground();
    render();
  });

  const content = document.createElement("div");
  const title = document.createElement("div");
  title.className = "conversation-title";
  title.textContent = conversation.title || "未命名会话";

  const meta = document.createElement("div");
  meta.className = "conversation-meta";
  meta.textContent = formatConversationMeta(conversation);

  content.append(title, meta);
  label.append(checkbox, content);
  return label;
}

function getFilteredConversations() {
  if (!state.searchTerm) {
    return state.conversations;
  }

  return state.conversations.filter((conversation) =>
    (conversation.title || "").toLowerCase().includes(state.searchTerm)
  );
}

function formatConversationMeta(conversation) {
  const parts = [];

  if (conversation.updateTime) {
    parts.push(`更新: ${new Date(conversation.updateTime).toLocaleString()}`);
  }

  parts.push(conversation.id);
  if (conversation.archived) {
    parts.push("归档");
  }
  return parts.join(" | ");
}

function summaryText(filteredCount, selectedCount) {
  const base = `已显示 ${filteredCount} / ${state.conversations.length} 个，已选择 ${selectedCount} 个`;

  if (!state.exportProgress) {
    return base;
  }

  const { current = 0, total = 0, done = false } = state.exportProgress;
  if (done) {
    return `${base}，导出完成 ${current}/${total}`;
  }

  return `${base}，导出中 ${current}/${total}`;
}

function setBusy({ loading = false, exporting = false }) {
  const busy = loading || exporting;
  elements.loadButton.disabled = busy;
  elements.selectAllButton.disabled = busy;
  elements.clearSelectionButton.disabled = busy;
  elements.exportButton.disabled = busy || state.selectedIds.size === 0;
}

function setStatus(message) {
  state.status = message;
  elements.status.textContent = message;
}
