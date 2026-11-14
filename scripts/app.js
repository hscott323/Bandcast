const appState = {
  user: null,
  conversations: [],
  friends: [],
  requests: [],
  onlineUsers: new Set(),
  activeConversation: null,
  socket: null,
  presenceSocket: null,
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (response.status === 401) {
    window.location.replace("login.html");
    throw new Error("Please sign in again.");
  }
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(result?.error || `Request failed (${response.status}).`);
  }
  return result;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function avatar(name, color = "#5865f2", imageUrl = null, className = "profile-avatar") {
  const element = node("span", className);
  element.setAttribute("aria-hidden", "true");
  element.textContent = Array.from(name.trim())[0]?.toUpperCase() || "?";
  element.style.setProperty("--avatar-color", color || "#5865f2");
  if (imageUrl) {
    const image = node("img", "profile-avatar-image");
    image.alt = "";
    image.src = imageUrl;
    element.replaceChildren(image);
    element.classList.add("has-profile-image");
  }
  return element;
}

function showNotice(message, isError = false) {
  let notice = document.querySelector("[data-app-notice]");
  if (!notice) {
    notice = node("p", "bc-notice");
    notice.dataset.appNotice = "";
    notice.setAttribute("role", "status");
    document.querySelector(".friend-workspace")?.prepend(notice);
  }
  notice.textContent = message;
  notice.classList.toggle("is-error", isError);
  notice.hidden = false;
  window.clearTimeout(showNotice.timeout);
  showNotice.timeout = window.setTimeout(() => {
    notice.hidden = true;
  }, 5000);
}

async function loadApp() {
  try {
    const { user } = await api("/api/auth/me");
    appState.user = user;
    updateSelfProfile();
    await refreshLists();
    connectPresence();
    bindAppControls();
  } catch (error) {
    if (error instanceof Error && error.message !== "Please sign in again.") {
      showNotice(error.message, true);
    }
  }
}

function updateSelfProfile() {
  const profileInfo = document.querySelector(".profile-info");
  const name = document.querySelector(".profile-name");
  const targetAvatar = document.querySelector(".profile-dock .profile-avatar");
  if (name) {
    name.textContent = appState.user.displayName;
  }
  if (targetAvatar) {
    targetAvatar.replaceWith(avatar(
      appState.user.displayName,
      appState.user.avatarColor,
      appState.user.avatarUrl,
    ));
  }
  profileInfo?.setAttribute("aria-label", `Profile for ${appState.user.username}`);
}

async function refreshLists() {
  const [conversationsResult, friendsResult, requestsResult] = await Promise.all([
    api("/api/conversations"),
    api("/api/friends"),
    api("/api/friend-requests"),
  ]);
  appState.conversations = conversationsResult.conversations;
  appState.friends = friendsResult.friends;
  appState.requests = requestsResult.requests;
  renderConversationList();
  const pendingButton = document.querySelector("[data-open-pending]");
  if (pendingButton) {
    const incomingCount = appState.requests.filter((request) => request.direction === "incoming").length;
    pendingButton.textContent = incomingCount ? `Pending (${incomingCount})` : "Pending";
  }
}

function renderConversationList() {
  const list = document.querySelector("[data-dm-list]");
  if (!list) {
    return;
  }
  list.replaceChildren();
  const groups = appState.conversations.filter((conversation) => conversation.kind === "group");
  const direct = appState.conversations.filter((conversation) => conversation.kind === "dm");
  const friendIds = new Set(appState.friends.map((friend) => friend.id));
  const directByPeer = new Map(direct
    .filter((conversation) => conversation.peer?.id)
    .map((conversation) => [conversation.peer.id, conversation]));

  const addSection = (title, items, renderItem) => {
    if (!items.length) {
      return;
    }
    list.append(node("h3", "dm-subheading", title));
    for (const item of items) {
      renderItem(item);
    }
  };

  const addConversation = (conversation) => {
    const button = node("button", "dm-entry");
    button.type = "button";
    button.classList.toggle("is-active", appState.activeConversation?.id === conversation.id);
    button.append(avatar(
      conversation.title || conversation.peer?.displayName || "Group",
      conversation.peer?.avatarColor || "#5865f2",
      conversation.iconUrl || conversation.peer?.avatarUrl,
      "profile-avatar",
    ));
    const details = node("span", "dm-contact-details");
    details.append(node("span", "dm-display-name", conversation.title || "Conversation"));
    if (conversation.kind === "dm" && conversation.peer?.id) {
      details.append(createPresenceIndicator(appState.onlineUsers.has(conversation.peer.id) ? "online" : "offline"));
    }
    button.append(details);
    button.addEventListener("click", () => {
      if (appState.activeConversation?.id === conversation.id) {
        closeConversation();
      } else {
        openConversation(conversation);
      }
    });
    button.addEventListener("contextmenu", (event) => {
      openConversationContextMenu(event, conversation);
    });
    list.append(button);
  };

  const addFriend = (friend) => {
    const conversation = directByPeer.get(friend.id);
    const button = node("button", "dm-entry");
    button.type = "button";
    button.classList.toggle(
      "is-active",
      Boolean(conversation) && appState.activeConversation?.id === conversation.id,
    );
    button.append(avatar(friend.displayName, friend.avatarColor, friend.avatarUrl, "profile-avatar"));
    const details = node("span", "dm-contact-details");
    details.append(node("span", "dm-display-name", friend.displayName));
    details.append(createPresenceIndicator(appState.onlineUsers.has(friend.id) ? "online" : "offline"));
    button.append(details);
    button.addEventListener("click", () => {
      if (appState.activeConversation?.peer?.id === friend.id) {
        closeConversation();
        return;
      }
      if (conversation) {
        openConversation(conversation);
      } else {
        openDirectMessage(friend);
      }
    });
    button.addEventListener("contextmenu", (event) => {
      if (conversation) {
        openConversationContextMenu(event, conversation);
      } else {
        event.preventDefault();
        openProfilePopover(friend.id, event.currentTarget);
      }
    });
    list.append(button);
  };

  addSection("Group Chats", groups, addConversation);
  addSection("Friends", appState.friends, addFriend);
  addSection(
    "Direct Messages",
    direct.filter((conversation) => !conversation.peer?.id || !friendIds.has(conversation.peer.id)),
    addConversation,
  );
}

function createConversationHeader(conversation) {
  const header = node("header", "chat-header");
  const back = node("button", "chat-back-button bc-secondary", "←");
  back.type = "button";
  back.title = "Back to conversations";
  back.setAttribute("aria-label", "Back to conversations");
  back.addEventListener("click", closeConversation);
  header.append(back);
  const picture = avatar(
    conversation.title || conversation.peer?.displayName || "Group",
    conversation.peer?.avatarColor,
    conversation.iconUrl || conversation.peer?.avatarUrl,
    "profile-avatar chat-header-avatar",
  );
  header.append(picture);
  const identity = node("div", "chat-header-identity");
  identity.append(node("strong", "", conversation.title || "Conversation"));
  if (conversation.kind === "dm" && conversation.peer?.username) {
    identity.append(node("span", "chat-header-username", `@${conversation.peer.username}`));
    bindProfileTrigger(picture, conversation.peer.id);
    bindProfileTrigger(identity, conversation.peer.id);
  }
  header.append(identity);
  if (conversation.kind === "group") {
    const members = node("button", "bc-secondary", "Members");
    members.type = "button";
    members.addEventListener("click", () => openGroupManager(conversation));
    header.append(members);
  }
  return header;
}

function createMessage(message, conversation) {
  const outgoing = message.senderId === appState.user.id;
  const wrapper = node("article", `chat-message chat-message-group ${outgoing ? "chat-message-outgoing" : ""}`);
  wrapper.dataset.messageId = message.id;
  wrapper.dataset.senderId = message.senderId;
  wrapper.tabIndex = 0;
  wrapper.classList.add("has-context-menu");
  if (!outgoing && conversation.kind === "group") {
    const authorName = message.senderName || message.senderUsername || "?";
    const author = node("button", "chat-message-author");
    author.type = "button";
    author.append(node("span", "", authorName));
    bindProfileTrigger(author, message.senderId);
    author.prepend(avatar(
      authorName,
      message.senderAvatarColor,
      message.senderAvatarUrl,
      "profile-avatar chat-message-author-avatar",
    ));
    wrapper.append(author);
  }
  const bubble = node("div", "chat-message-bubble");
  if (message.deleted) {
    bubble.append(node("p", "chat-message-text bc-deleted-message", "Message deleted"));
  } else if (message.file) {
    const file = message.file;
    const fileUrl = file.url;
    if (file.contentType.startsWith("image/")) {
      wrapper.classList.add("chat-message-media");
      const image = node("img", "chat-attachment-image");
      image.src = fileUrl;
      image.alt = file.name;
      bubble.append(image);
    } else if (file.contentType.startsWith("video/")) {
      wrapper.classList.add("chat-message-media");
      const video = node("video", "chat-attachment-video");
      video.src = fileUrl;
      video.controls = true;
      bubble.append(video);
    } else {
      const link = node("a", "chat-file-link", file.name);
      link.href = fileUrl;
      link.target = "_blank";
      link.rel = "noopener";
      bubble.append(link);
    }
  } else if (message.gifUrl) {
    wrapper.classList.add("chat-message-media");
    const image = node("img", "chat-gif");
    image.src = normalizeGifUrl(message.gifUrl);
    image.alt = "GIF";
    bubble.append(image);
  } else {
    bubble.append(node("p", "chat-message-text", message.body || ""));
  }
  wrapper.append(bubble);
  const time = node("time", "bc-message-time", formatTime(message.createdAt));
  wrapper.append(time);
  wrapper.addEventListener("contextmenu", (event) => {
    openMessageMenu(event, message, conversation);
  });
  wrapper.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      const bounds = wrapper.getBoundingClientRect();
      if (openMessageMenu({ clientX: bounds.left, clientY: bounds.bottom }, message, conversation)) {
        event.preventDefault();
      }
    }
  });
  return wrapper;
}

function formatTime(seconds) {
  return new Date(seconds * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function createPresenceIndicator(status) {
  const presence = node("span", `friend-presence friend-presence-${status}`);
  const dot = node("span", "friend-presence-dot");
  dot.setAttribute("aria-hidden", "true");
  presence.append(dot, node("span", "", status === "online" ? "Online" : "Offline"));
  return presence;
}

function normalizeGifUrl(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/media\/([a-z0-9]+)(?:\/|$)/i)
      || url.pathname.match(/^\/embed\/([a-z0-9]+)\/?$/i)
      || url.pathname.split("/").filter(Boolean).pop()?.match(/-([a-z0-9]{6,})$/i)
      || url.pathname.split("/").filter(Boolean).pop()?.match(/^([a-z0-9]{8,})$/i);
    if (match && /(^|\.)giphy\.com$/i.test(url.hostname)) {
      return `https://media.giphy.com/media/${match[1]}/giphy.gif`;
    }
    return url.href;
  } catch {
    return value;
  }
}

function closeConversation() {
  appState.activeConversation = null;
  document.querySelector(".demo-screen")?.classList.remove("is-chat-open");
  appState.socket?.close();
  appState.socket = null;
  renderConversationList();
  const view = document.querySelector("[data-friend-view]");
  if (view) {
    view.hidden = true;
    view.classList.remove("is-chat-view");
    view.replaceChildren();
  }
}

async function openConversation(conversation) {
  appState.activeConversation = conversation;
  document.querySelector(".demo-screen")?.classList.add("is-chat-open");
  renderConversationList();
  const view = document.querySelector("[data-friend-view]");
  if (!view) {
    return;
  }
  view.hidden = false;
  view.classList.add("is-chat-view");
  view.replaceChildren(createConversationHeader(conversation));
  const list = node("div", "chat-message-list");
  list.setAttribute("aria-live", "polite");
  const loading = node("p", "bc-empty", "Loading messages…");
  list.append(loading);
  view.append(list);
  const composer = createComposer(conversation);
  view.append(composer);
  try {
    const result = await api(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`);
    list.replaceChildren();
    if (!result.messages.length) {
      list.append(node("p", "bc-empty", "No messages yet. Say hello!"));
    } else {
      result.messages.forEach((message) => list.append(createMessage(message, conversation)));
    }
    list.scrollTop = list.scrollHeight;
    await api(`/api/conversations/${encodeURIComponent(conversation.id)}/read`, { method: "POST" });
    connectRealtime(conversation);
  } catch (error) {
    list.replaceChildren(node("p", "bc-error", error.message));
  }
}

function createComposer(conversation) {
  const form = node("form", "chat-composer");
  const attach = node("button", "chat-attach-button");
  attach.type = "button";
  attach.classList.add("bc-attach");
  attach.setAttribute("aria-label", "Attach a file");
  const attachIcon = node("span", "chat-attach-icon");
  attachIcon.setAttribute("aria-hidden", "true");
  attach.append(attachIcon);
  const fileInput = node("input", "bc-hidden-input");
  fileInput.type = "file";
  fileInput.accept = "image/*,video/mp4,video/webm,application/pdf,text/plain";
  attach.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    formData.set("conversationId", conversation.id);
    try {
      const upload = await api("/api/files", { method: "POST", body: formData });
      await api(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, {
        method: "POST",
        body: JSON.stringify({ fileId: upload.file.id }),
      });
      await openConversation(conversation);
    } catch (error) {
      showNotice(error.message, true);
    } finally {
      fileInput.value = "";
    }
  });

  const input = node("textarea", "chat-composer-input");
  input.name = "body";
  input.rows = 1;
  input.maxLength = 4000;
  input.placeholder = `Message ${conversation.title || conversation.peer?.displayName || "conversation"}`;
  input.setAttribute("aria-label", "Message");
  const gifButton = node("button", "chat-gif-button", "GIF");
  gifButton.type = "button";
  gifButton.setAttribute("aria-label", "Send a GIF URL");
  gifButton.addEventListener("click", async () => {
    const url = window.prompt("Paste a GIPHY URL");
    if (!url) {
      return;
    }
    try {
      await api(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, {
        method: "POST",
        body: JSON.stringify({ gifUrl: normalizeGifUrl(url) }),
      });
      await openConversation(conversation);
    } catch (error) {
      showNotice(error.message, true);
    }
  });
  form.append(attach, fileInput, input, gifButton);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      return;
    }
    input.disabled = true;
    try {
      await api(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      await refreshLists();
      await openConversation(conversation);
    } catch (error) {
      showNotice(error.message, true);
      input.disabled = false;
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  return form;
}

function closeContextMenu() {
  document.querySelector(".bc-context-menu")?.remove();
}

function openMessageMenu(event, message, conversation) {
  closeContextMenu();
  if (message.deleted) {
    return false;
  }
  const ownMessage = message.senderId === appState.user.id;
  const canDelete = ownMessage || (conversation.kind === "group" && conversation.ownerId === appState.user.id);
  if (!ownMessage && !canDelete) {
    return false;
  }
  if (typeof event.preventDefault === "function") {
    event.preventDefault();
  }
  const menu = node("div", "bc-context-menu");
  menu.setAttribute("role", "menu");
  if (ownMessage && typeof message.body === "string" && message.body.length > 0) {
    const edit = node("button", "", "Edit message");
    edit.type = "button";
    edit.setAttribute("role", "menuitem");
    edit.addEventListener("click", () => editMessage(message, conversation));
    menu.append(edit);
  }
  if (canDelete) {
    const remove = node("button", "is-danger", "Delete message");
    remove.type = "button";
    remove.setAttribute("role", "menuitem");
    remove.addEventListener("click", async () => {
      closeContextMenu();
      if (!window.confirm("Delete this message?")) {
        return;
      }
      try {
        await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" });
        await openConversation(conversation);
      } catch (error) {
        showNotice(error.message, true);
      }
    });
    menu.append(remove);
  }
  document.body.append(menu);
  const menuBounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menuBounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menuBounds.height - 8))}px`;
  return true;
}

function openConversationContextMenu(event, conversation) {
  event.preventDefault();
  closeContextMenu();
  const menu = node("div", "bc-context-menu");
  menu.setAttribute("role", "menu");
  const anchor = event.currentTarget;
  const action = node("button", "", conversation.kind === "dm" ? "View profile" : "Manage group");
  action.type = "button";
  action.setAttribute("role", "menuitem");
  action.addEventListener("click", () => {
    closeContextMenu();
    if (conversation.kind === "dm") {
      openProfilePopover(conversation.peer.id, anchor);
    } else {
      openGroupManager(conversation);
    }
  });
  menu.append(action);
  document.body.append(menu);
  const menuBounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menuBounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menuBounds.height - 8))}px`;
}

async function editMessage(message, conversation) {
  closeContextMenu();
  const element = document.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  const bubble = element?.querySelector(".chat-message-bubble");
  if (!bubble) {
    return;
  }
  const form = node("form", "bc-edit-form");
  const input = node("textarea", "chat-message-edit-input");
  input.value = message.body || "";
  input.maxLength = 4000;
  const save = node("button", "bc-primary", "Save");
  save.type = "submit";
  const cancel = node("button", "bc-secondary", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => openConversation(conversation));
  form.append(input, save, cancel);
  bubble.replaceChildren(form);
  input.focus();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/messages/${encodeURIComponent(message.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ body: input.value }),
      });
      await openConversation(conversation);
    } catch (error) {
      showNotice(error.message, true);
    }
  });
}

function openDialog(titleText, descriptionText = "", { showClose = true } = {}) {
  const overlay = node("div", "bc-overlay");
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });
  const dialog = node("section", "bc-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const heading = node("h2", "", titleText);
  const description = node("p", "bc-dialog-description", descriptionText);
  dialog.append(heading);
  if (descriptionText) {
    dialog.append(description);
  }
  if (showClose) {
    const close = node("button", "bc-dialog-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.title = "Close";
    close.addEventListener("click", () => overlay.remove());
    dialog.append(close);
  }
  overlay.append(dialog);
  document.body.append(overlay);
  return { overlay, dialog };
}

async function openGroupManager(conversation) {
  const { overlay, dialog } = openDialog("Manage group", conversation.title);
  try {
    const result = await api(`/api/conversations/${encodeURIComponent(conversation.id)}/members`);
    const owner = result.ownerId === appState.user.id;
    const list = node("div", "bc-member-list");
    for (const member of result.members) {
      const row = node("div", "bc-member-row");
      const picture = avatar(member.displayName, member.avatarColor, member.avatarUrl);
      bindProfileTrigger(picture, member.id);
      row.append(picture);
      const text = node("button", "bc-member-name", `${member.displayName} | @${member.username}${member.role === "owner" ? " | Owner" : ""}`);
      text.type = "button";
      bindProfileTrigger(text, member.id);
      row.append(text);
      if (owner && member.id !== appState.user.id) {
        row.append(makeAction("Kick", () => updateMember(conversation, member, "kick")));
        row.append(makeAction("Ban", () => updateMember(conversation, member, "ban")));
      }
      list.append(row);
    }
    dialog.append(list);

    if (owner) {
      const actions = node("div", "bc-dialog-actions");
      actions.append(makeAction("Invite a friend", () => inviteGroupFriend(
        conversation,
        overlay,
        result.members.map((member) => member.id),
      )));
      actions.append(makeAction("Create invite code", () => createGroupInvite(conversation, dialog)));
      actions.append(makeAction("Rename group", () => renameGroup(conversation, overlay)));
      const iconInput = node("input", "bc-hidden-input");
      iconInput.type = "file";
      iconInput.accept = "image/*";
      const iconButton = makeAction("Change group icon", () => iconInput.click());
      iconInput.addEventListener("change", () => updateGroupIcon(conversation, iconInput.files?.[0], overlay));
      actions.append(iconButton, iconInput);
      const bans = result.banned || [];
      if (bans.length) {
        actions.append(node("h3", "", "Banned members"));
        for (const banned of bans) {
          actions.append(node("span", "bc-banned-row", `@${banned.username}`));
          actions.append(makeAction("Unban", async () => {
            await api(`/api/conversations/${encodeURIComponent(conversation.id)}/bans/${encodeURIComponent(banned.id)}`, { method: "DELETE" });
            overlay.remove();
            openGroupManager(conversation);
          }));
        }
      }
      dialog.append(actions);
    } else {
      dialog.append(makeAction("Leave group", async () => {
        if (window.confirm("Leave this group?")) {
          await api(`/api/conversations/${encodeURIComponent(conversation.id)}/members/${encodeURIComponent(appState.user.id)}`, { method: "DELETE" });
          overlay.remove();
          appState.activeConversation = null;
          await refreshLists();
          closeConversation();
        }
      }));
    }
  } catch (error) {
    dialog.append(node("p", "bc-error", error.message));
  }
}

function makeAction(label, action) {
  const button = node("button", "bc-secondary", label);
  button.type = "button";
  button.addEventListener("click", () => Promise.resolve(action()).catch((error) => showNotice(error.message, true)));
  return button;
}

async function updateMember(conversation, member, action) {
  const path = `/api/conversations/${encodeURIComponent(conversation.id)}/${action === "ban" ? "bans" : "members"}/${encodeURIComponent(member.id)}`;
  await api(path, { method: action === "ban" ? "POST" : "DELETE" });
  showNotice(action === "ban" ? "Member banned." : "Member removed.");
  document.querySelector(".bc-overlay")?.remove();
  await openGroupManager(conversation);
}

async function inviteGroupFriend(conversation, overlay, memberIds) {
  const eligible = appState.friends.filter((friend) =>
    !memberIds.includes(friend.id));
  const username = window.prompt(`Friend username to add:\n${eligible.map((friend) => `@${friend.username}`).join(", ")}`);
  if (!username) {
    return;
  }
  const friend = eligible.find((entry) => entry.username.toLowerCase() === username.replace(/^@/, "").toLowerCase());
  if (!friend) {
    showNotice("Choose one of your friends who is not already in this group.", true);
    return;
  }
  await api(`/api/conversations/${encodeURIComponent(conversation.id)}/members`, {
    method: "POST",
    body: JSON.stringify({ userId: friend.id }),
  });
  overlay.remove();
  await openGroupManager(conversation);
  showNotice("Friend invited.");
}

async function createGroupInvite(conversation, dialog) {
  const result = await api(`/api/conversations/${encodeURIComponent(conversation.id)}/invites`, { method: "POST" });
  const code = node("p", "bc-invite-code", result.code);
  const expiry = node("p", "bc-dialog-description", `Expires ${formatTime(result.expiresAt)}. Share this 8-digit code; it is not a link.`);
  dialog.append(code, expiry);
}

async function renameGroup(conversation, overlay) {
  const name = window.prompt("New group name", conversation.title);
  if (!name?.trim()) {
    return;
  }
  await api(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name: name.trim() }),
  });
  overlay.remove();
  await refreshLists();
  const updated = appState.conversations.find((entry) => entry.id === conversation.id);
  if (updated) {
    await openConversation(updated);
    openGroupManager(updated);
  }
}

async function updateGroupIcon(conversation, file, overlay) {
  if (!file) {
    return;
  }
  const formData = new FormData();
  formData.set("file", file);
  try {
    await api(`/api/conversations/${encodeURIComponent(conversation.id)}/icon`, {
      method: "POST",
      body: formData,
    });
    overlay.remove();
    await refreshLists();
    const updated = appState.conversations.find((entry) => entry.id === conversation.id);
    if (updated) {
      await openConversation(updated);
    }
  } catch (error) {
    showNotice(error.message, true);
  }
}

function showJoinGroupDialog() {
  const { dialog } = openDialog("Join a group", "Ask a group member for its active 8-digit invite code.", { showClose: false });
  const form = node("form", "bc-form");
  const label = node("label", "", "Invite code");
  const input = node("input", "");
  input.inputMode = "numeric";
  input.maxLength = 8;
  input.pattern = "[0-9]{8}";
  input.required = true;
  label.append(input);
  const submit = node("button", "bc-primary", "Join group");
  submit.type = "submit";
  form.append(label, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/api/invites/join", {
        method: "POST",
        body: JSON.stringify({ code: input.value }),
      });
      document.querySelector(".bc-overlay")?.remove();
      await refreshLists();
      const conversation = appState.conversations.find((entry) => entry.id === result.conversationId);
      if (conversation) {
        await openConversation(conversation);
      }
    } catch (error) {
      showNotice(error.message, true);
    }
  });
  dialog.append(form);
  input.focus();
}

function showAddFriendDialog() {
  const { dialog } = openDialog("Add a friend", "Find someone by their username.", { showClose: false });
  const form = node("form", "bc-form");
  const input = node("input", "");
  input.placeholder = "Username";
  input.autocomplete = "off";
  input.required = true;
  const search = node("button", "bc-primary", "Search");
  search.type = "submit";
  const results = node("div", "bc-search-results");
  form.append(input, search);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    results.replaceChildren();
    try {
      const response = await api(`/api/users/search?q=${encodeURIComponent(input.value.trim())}`);
      if (!response.users.length) {
        results.append(node("p", "bc-empty", "No discoverable users found."));
      }
      response.users.forEach((friend) => {
        const row = node("div", "bc-member-row");
        row.append(avatar(friend.displayName, friend.avatarColor, friend.avatarUrl));
        row.append(node("span", "bc-member-name", `${friend.displayName} | @${friend.username}`));
        row.append(createPresenceIndicator(appState.onlineUsers.has(friend.id) ? "online" : "offline"));
        row.append(makeAction("Send request", async () => {
          await api("/api/friend-requests", {
            method: "POST",
            body: JSON.stringify({ username: friend.username }),
          });
          showNotice("Friend request sent.");
          await refreshLists();
        }));
        results.append(row);
      });
    } catch (error) {
      results.append(node("p", "bc-error", error.message));
    }
  });
  dialog.append(form, results);
  input.focus();
}

async function showPendingRequests() {
  const { dialog } = openDialog("Friend requests", "", { showClose: false });
  try {
    const { requests } = await api("/api/friend-requests");
    if (!requests.length) {
      dialog.append(node("p", "bc-empty", "No pending requests."));
    }
    for (const request of requests) {
      const row = node("div", "bc-member-row");
      row.append(avatar(request.user.displayName, request.user.avatarColor, request.user.avatarUrl));
      row.append(node("span", "bc-member-name", `${request.user.displayName} | @${request.user.username} | ${request.direction}`));
      if (request.direction === "incoming") {
        row.append(makeAction("Accept", async () => {
          await api(`/api/friend-requests/${encodeURIComponent(request.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "accept" }),
          });
          document.querySelector(".bc-overlay")?.remove();
          await refreshLists();
        }));
        row.append(makeAction("Decline", async () => {
          await api(`/api/friend-requests/${encodeURIComponent(request.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "decline" }),
          });
          document.querySelector(".bc-overlay")?.remove();
          await refreshLists();
        }));
      } else {
        row.append(makeAction("Cancel", async () => {
          await api(`/api/friend-requests/${encodeURIComponent(request.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ action: "cancel" }),
          });
          document.querySelector(".bc-overlay")?.remove();
          await refreshLists();
        }));
      }
      dialog.append(row);
    }
  } catch (error) {
    dialog.append(node("p", "bc-error", error.message));
  }
}

async function showCreateGroupDialog() {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const { dialog } = openDialog(
    "Create a group",
    isMobile
      ? "Choose a name. You can add friends after the group is created."
      : "Choose a name and invite any of your friends.",
    { showClose: false },
  );
  const form = node("form", "bc-form");
  const name = node("input");
  name.placeholder = "Group name";
  name.maxLength = 60;
  name.required = true;
  const list = isMobile ? null : node("div", "bc-group-friends");
  if (list) {
    appState.friends.forEach((friend) => {
      const label = node("label", "bc-check-row");
      const checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.value = friend.id;
      label.append(checkbox, node("span", "", `${friend.displayName} | @${friend.username}`));
      list.append(label);
    });
  }
  const submit = node("button", "bc-primary", "Create group");
  submit.type = "submit";
  form.append(name, submit);
  if (list) {
    form.append(list);
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const memberIds = list
      ? Array.from(list.querySelectorAll('input[type="checkbox"]:checked'), (input) => input.value)
      : [];
    try {
      const result = await api("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ kind: "group", name: name.value.trim(), memberIds }),
      });
      document.querySelector(".bc-overlay")?.remove();
      await refreshLists();
      const conversation = appState.conversations.find((entry) => entry.id === result.conversation.id);
      if (conversation) {
        await openConversation(conversation);
      }
    } catch (error) {
      showNotice(error.message, true);
    }
  });
  dialog.append(form);
}

async function openDirectMessage(friend) {
  try {
    const { conversation } = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ kind: "dm", userId: friend.id }),
    });
    await refreshLists();
    const entry = appState.conversations.find((item) => item.id === conversation.id);
    if (entry) {
      await openConversation(entry);
    }
  } catch (error) {
    showNotice(error.message, true);
  }
}

function bindProfileTrigger(element, userId) {
  if (element.dataset.profileTrigger === String(userId)) {
    return;
  }
  element.dataset.profileTrigger = String(userId);
  element.classList.add("bc-profile-trigger");
  element.setAttribute("role", "button");
  element.setAttribute("aria-haspopup", "dialog");
  element.setAttribute("aria-label", `View profile for ${element.textContent.trim() || "user"}`);
  element.removeAttribute("aria-hidden");
  if (!(element instanceof HTMLButtonElement)) {
    element.tabIndex = 0;
  }
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    openProfilePopover(userId, element);
  });
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openProfilePopover(userId, element);
  });
  if (!(element instanceof HTMLButtonElement)) {
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openProfilePopover(userId, element);
      }
    });
  }
}

let profilePopoverRequest = null;

async function openProfilePopover(userId, anchor) {
  const profileId = String(userId);
  const existing = document.querySelector(".profile-popover");
  if (existing?.dataset.profileId === profileId) {
    existing.remove();
    profilePopoverRequest = null;
    return;
  }
  if (profilePopoverRequest?.userId === profileId) {
    profilePopoverRequest = null;
    return;
  }
  existing?.remove();
  const request = { userId: profileId };
  profilePopoverRequest = request;
  try {
    const profile = userId === appState.user.id
      ? appState.user
      : (await api(`/api/users/${encodeURIComponent(userId)}/profile`)).profile;
    if (profilePopoverRequest !== request) {
      return;
    }
    profilePopoverRequest = null;
    document.querySelector(".profile-popover")?.remove();
    const popover = node("section", "profile-popover");
    popover.dataset.profileId = String(profile.id);
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", `Profile for ${profile.username}`);

    const header = node("div", "profile-popover-header");
    header.append(avatar(
      profile.displayName,
      profile.avatarColor,
      profile.avatarUrl,
      "profile-avatar profile-popover-avatar",
    ));
    const identity = node("div", "profile-popover-identity");
    identity.append(node("h2", "profile-popover-name", profile.displayName));
    identity.append(node("p", "profile-popover-username", `@${profile.username}`));
    header.append(identity);
    const about = node("div", "profile-popover-about");
    about.append(node("h3", "", "About me"));
    about.append(node("p", "", profile.bio || "No bio added yet."));
    popover.append(header, about);

    if (profile.id === appState.user.id) {
      const edit = node("a", "profile-popover-edit");
      edit.href = "settings.html#profile";
      edit.setAttribute("aria-label", "Edit profile");
      edit.title = "Edit profile";
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z",
      );
      icon.append(path);
      edit.append(icon);
      const actions = node("div", "profile-popover-actions");
      const logout = node("button", "profile-popover-action", "Log out");
      logout.type = "button";
      logout.dataset.logout = "";
      const remove = node("button", "profile-popover-action is-danger", "Delete account");
      remove.type = "button";
      remove.dataset.deleteAccount = "";
      actions.append(logout, remove);
      popover.append(edit, actions);
    } else if (appState.friends.some((friend) => friend.id === profile.id)) {
      const message = node("button", "profile-popover-message", "Message");
      message.type = "button";
      message.addEventListener("click", () => {
        popover.remove();
        openDirectMessage(profile);
      });
      popover.append(message);
    }

    document.body.append(popover);
    popover.style.maxHeight = "calc(100dvh - 24px)";
    popover.style.overflowY = "auto";
    const anchorBounds = anchor.getBoundingClientRect();
    const popoverBounds = popover.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchorBounds.left, window.innerWidth - popoverBounds.width - 12));
    const above = anchorBounds.top - popoverBounds.height - 10;
    const top = above >= 12
      ? above
      : Math.min(anchorBounds.bottom + 10, window.innerHeight - popoverBounds.height - 12);
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(12, top)}px`;
  } catch (error) {
    if (profilePopoverRequest === request) {
      profilePopoverRequest = null;
    }
    showNotice(error.message, true);
  }
}

function applyPresence(userId, online) {
  if (typeof userId !== "string") {
    return;
  }
  if (online) {
    appState.onlineUsers.add(userId);
  } else {
    appState.onlineUsers.delete(userId);
  }
  renderConversationList();
}

function connectPresence() {
  if (appState.presenceSocket || !("WebSocket" in window)) {
    return;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime?presence=1`);
  appState.presenceSocket = socket;
  socket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.type === "connected") {
      appState.onlineUsers.clear();
      renderConversationList();
    } else if (payload.type === "presence") {
      applyPresence(payload.userId, payload.online === true);
    }
  });
  socket.addEventListener("close", () => {
    if (appState.presenceSocket !== socket) {
      return;
    }
    appState.presenceSocket = null;
    window.setTimeout(connectPresence, 3000);
  });
  socket.addEventListener("error", () => {
    console.error("Presence connection failed; retrying.");
  });
}

function connectRealtime(conversation) {
  if (appState.socket) {
    appState.socket.close();
    appState.socket = null;
  }
  renderConversationList();
  if (!("WebSocket" in window)) {
    return;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime?conversationId=${encodeURIComponent(conversation.id)}`);
  appState.socket = socket;
  socket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (appState.activeConversation?.id !== conversation.id) {
      return;
    }
    if (payload.type === "message") {
      if (payload.message?.senderId === appState.user.id) {
        return;
      }
      openConversation(conversation);
      refreshLists().catch((error) => console.error("Could not refresh conversations.", error));
    } else if (payload.type === "message-update" || payload.type === "message-delete") {
      if (payload.actorId === appState.user.id) {
        return;
      }
      openConversation(conversation);
    }
  });
  socket.addEventListener("error", () => {
    console.error("Realtime connection failed; messages remain available through refresh.");
  });
}

function bindAppControls() {
  document.querySelector("[data-open-pending]")?.addEventListener("click", showPendingRequests);
  document.querySelector("[data-open-add-friend]")?.addEventListener("click", showAddFriendDialog);
  document.querySelector("[data-open-join-group]")?.addEventListener("click", showJoinGroupDialog);
  document.querySelector("[data-create-group]")?.addEventListener("click", showCreateGroupDialog);
  document.querySelector(".profile-info")?.addEventListener("click", (event) => {
    openProfilePopover(appState.user.id, event.currentTarget);
  });
  document.querySelector(".settings-button")?.addEventListener("click", () => {
    window.location.href = "settings.html";
  });
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    if (!event.target.closest(".bc-context-menu")) {
      closeContextMenu();
    }
    if (!event.target.closest(".profile-popover") && !event.target.closest(".profile-info")) {
      document.querySelector(".profile-popover")?.remove();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeContextMenu();
      document.querySelector(".bc-overlay")?.remove();
      document.querySelector(".profile-popover")?.remove();
    }
  });
}

if (document.body.dataset.page === "app") {
  loadApp();
}
