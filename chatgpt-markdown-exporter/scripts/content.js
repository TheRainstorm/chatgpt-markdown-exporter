(() => {
  if (globalThis.__chatgptMarkdownExporterLoaded) {
    return;
  }

  globalThis.__chatgptMarkdownExporterLoaded = true;

  const API_LIMIT = 28;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "list-chatgpt-conversations") {
      listConversations(message.limit || API_LIMIT).then(sendResponse);
      return true;
    }

    if (message?.type === "export-chatgpt-conversation-by-id") {
      exportConversationById(message.conversationId).then(sendResponse);
      return true;
    }

    return false;
  });

  async function listConversations(limit) {
    try {
      const authState = { token: await getAccessToken() };
      const pageLimit = Math.max(1, Math.min(Number(limit) || API_LIMIT, 50));
      const standard = await fetchConversationPass(authState, pageLimit, false);
      const archived = await fetchConversationPass(authState, pageLimit, true).catch((error) => ({
        conversations: [],
        complete: false,
        reason: error?.message || "读取归档会话失败。"
      }));
      const byId = new Map();

      for (const item of [...standard.conversations, ...archived.conversations]) {
        if (item?.id) {
          byId.set(String(item.id), item);
        }
      }

      const conversations = Array.from(byId.values())
        .map(normalizeConversationListItem)
        .filter(Boolean)
        .sort((left, right) => new Date(right.updateTime || 0) - new Date(left.updateTime || 0));

      return {
        ok: true,
        conversations,
        count: conversations.length,
        scan: {
          standard: {
            count: standard.conversations.length,
            complete: standard.complete,
            reason: standard.reason
          },
          archived: {
            count: archived.conversations.length,
            complete: archived.complete,
            reason: archived.reason
          }
        }
      };
    } catch (error) {
      return { ok: false, error: explainFetchError(error) };
    }
  }

  async function exportConversationById(conversationId) {
    try {
      if (!conversationId) {
        throw new Error("缺少会话 ID。");
      }

      const authState = { token: await getAccessToken() };
      const conversation = await fetchJsonAuthorized(
        `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
        authState
      );
      const markdown = conversationToMarkdown(conversation);

      return {
        ok: true,
        filename: `${safeTitle(conversation.title || "ChatGPT 对话")}-${conversationId}.md`,
        markdown
      };
    } catch (error) {
      return { ok: false, error: explainFetchError(error) };
    }
  }

  async function getAccessToken() {
    const data = await fetchJson("/api/auth/session");
    const token = typeof data?.accessToken === "string" ? data.accessToken : "";

    if (!token) {
      throw new Error("没有拿到 ChatGPT 登录令牌，请确认页面已登录后再刷新重试。");
    }

    return token;
  }

  async function fetchConversationPass(authState, limit, isArchived) {
    const conversations = [];
    const seenIds = new Set();
    let offset = 0;
    let pagesScanned = 0;

    while (pagesScanned < 500) {
      const page = await fetchConversationsPage({ offset, limit, isArchived }, authState);
      pagesScanned += 1;

      if (page.items.length === 0) {
        return {
          conversations,
          complete: true,
          reason: "接口返回空页。"
        };
      }

      let newItemCount = 0;
      for (const item of page.items) {
        if (!item?.id || seenIds.has(String(item.id))) {
          continue;
        }

        seenIds.add(String(item.id));
        conversations.push({ ...item, is_archived: isArchived });
        newItemCount += 1;
      }

      if (newItemCount === 0) {
        return {
          conversations,
          complete: false,
          reason: "分页没有返回新的会话 ID。"
        };
      }

      offset += page.items.length;

      if (page.hasMore === false) {
        return {
          conversations,
          complete: true,
          reason: "接口报告没有更多分页。"
        };
      }
    }

    return {
      conversations,
      complete: false,
      reason: "达到最大分页扫描上限。"
    };
  }

  async function fetchConversationsPage({ offset, limit, isArchived }, authState) {
    const parameters = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      order: "updated"
    });

    if (isArchived) {
      parameters.set("is_archived", "true");
    }

    const data = await fetchJsonAuthorized(`/backend-api/conversations?${parameters.toString()}`, authState);
    let items = [];
    let hasMore = null;

    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === "object") {
      if (Array.isArray(data.items)) {
        items = data.items;
      } else if (Array.isArray(data.conversations)) {
        items = data.conversations;
      }

      if (typeof data.has_more === "boolean") {
        hasMore = data.has_more;
      } else if (typeof data.hasMore === "boolean") {
        hasMore = data.hasMore;
      } else if (typeof data.has_missing_conversations === "boolean") {
        hasMore = data.has_missing_conversations;
      } else if (Number.isFinite(Number(data.total))) {
        hasMore = offset + items.length < Number(data.total);
      }
    }

    return { items, hasMore };
  }

  async function fetchJson(path) {
    const response = await fetch(new URL(path, location.origin), {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`ChatGPT 接口返回 ${response.status}`);
    }

    return response.json();
  }

  async function fetchJsonAuthorized(path, authState, hasRefreshed = false) {
    const response = await fetch(new URL(path, location.origin), {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${authState.token}`
      }
    });

    if (response.status === 401 && !hasRefreshed) {
      authState.token = await getAccessToken();
      return fetchJsonAuthorized(path, authState, true);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`ChatGPT 接口返回 ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
    }

    return response.json();
  }

  function normalizeConversationListItem(item) {
    if (!item?.id) {
      return null;
    }

    return {
      id: item.id,
      title: item.title || "未命名会话",
      createTime: parseApiTime(item.create_time),
      updateTime: parseApiTime(item.update_time),
      archived: Boolean(item.is_archived)
    };
  }

  function conversationToMarkdown(conversation) {
    const turns = extractTurns(conversation);
    const title = conversation.title || "ChatGPT 对话";
    const lines = [
      `# ${escapeMarkdownHeading(title)}`,
      "",
      `- 会话 ID: ${conversation.conversation_id || conversation.id || ""}`,
      `- 导出时间: ${new Date().toLocaleString()}`,
      `- 来源: ${location.origin}/c/${conversation.conversation_id || conversation.id || ""}`,
      ""
    ];

    if (turns.length === 0) {
      lines.push("> 这个会话没有可导出的文本消息。");
    } else {
      turns.forEach((turn, index) => {
        lines.push(`## ${index + 1}. ${roleLabel(turn.role)}`, "", turn.content, "");
      });
    }

    return lines.join("\n").trim() + "\n";
  }

  function extractTurns(conversation) {
    const mapping = conversation.mapping || {};
    const orderedNodes = getOrderedMessageNodes(conversation, mapping);

    return orderedNodes
      .map((node) => node.message)
      .filter((message) => message && message.author?.role && message.content)
      .filter((message) => !["system", "tool"].includes(message.author.role))
      .map((message) => ({
        role: message.author.role,
        content: messageContentToMarkdown(message).trim()
      }))
      .filter((turn) => turn.content);
  }

  function getOrderedMessageNodes(conversation, mapping) {
    const currentNodeId = conversation.current_node;

    if (currentNodeId && mapping[currentNodeId]) {
      const nodes = [];
      let node = mapping[currentNodeId];
      const seen = new Set();

      while (node && !seen.has(node.id)) {
        seen.add(node.id);
        if (node.message) {
          nodes.push(node);
        }
        node = node.parent ? mapping[node.parent] : null;
      }

      return nodes.reverse();
    }

    return Object.values(mapping)
      .filter((node) => node?.message)
      .sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));
  }

  function messageContentToMarkdown(message) {
    const content = message.content || {};

    if (Array.isArray(content.parts)) {
      return content.parts.map(partToMarkdown).filter(Boolean).join("\n\n");
    }

    if (typeof content.text === "string") {
      return content.text;
    }

    if (Array.isArray(content.result)) {
      return content.result.map(partToMarkdown).filter(Boolean).join("\n\n");
    }

    return "";
  }

  function partToMarkdown(part) {
    if (typeof part === "string") {
      return part;
    }

    if (!part || typeof part !== "object") {
      return "";
    }

    if (typeof part.text === "string") {
      return part.text;
    }

    if (part.content_type === "image_asset_pointer" || part.asset_pointer) {
      return `[图片: ${part.asset_pointer || part.content_type}]`;
    }

    if (part.content_type === "audio_transcription" && part.text) {
      return `[音频转写]\n\n${part.text}`;
    }

    if (part.name || part.mime_type) {
      return `[附件: ${part.name || part.mime_type}]`;
    }

    return "";
  }

  function roleLabel(role) {
    if (role === "user") {
      return "用户";
    }

    if (role === "assistant") {
      return "ChatGPT";
    }

    return role || "消息";
  }

  function parseApiTime(value) {
    if (!value) {
      return "";
    }

    if (typeof value === "number") {
      return new Date(value * 1000).toISOString();
    }

    return value;
  }

  function escapeMarkdownHeading(text) {
    return String(text).replace(/^#+\s*/, "").trim() || "ChatGPT 对话";
  }

  function safeTitle(text) {
    return String(text)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "ChatGPT 对话";
  }

  function explainFetchError(error) {
    const message = error?.message || "请求 ChatGPT 数据失败。";

    if (message.includes("401") || message.includes("403")) {
      return "无法读取会话，请确认 ChatGPT 页面已登录。";
    }

    return message;
  }
})();
