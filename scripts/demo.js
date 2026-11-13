function getProfileInitial(name) {
  const firstCharacter = Array.from(name.trim())[0];
  return firstCharacter ? Array.from(firstCharacter.toUpperCase())[0] || "?" : "?";
}

function setProfileAvatar(avatar, name, color = "#5865f2") {
  const initial = getProfileInitial(name);
  avatar.textContent = initial;
  avatar.style.setProperty("--avatar-color", color);
}

function createProfileAvatar(name, color, className = "profile-avatar") {
  const avatar = document.createElement("span");
  avatar.className = className;
  avatar.setAttribute("aria-hidden", "true");
  setProfileAvatar(avatar, name, color);
  return avatar;
}

function setProfileAvatarImage(avatar, imageSource) {
  if (typeof imageSource !== "string" || !imageSource.startsWith("data:image/")) {
    avatar.classList.remove("has-profile-image");
    return;
  }

  const image = document.createElement("img");
  image.className = "profile-avatar-image";
  image.src = imageSource;
  image.alt = "";
  avatar.classList.add("has-profile-image");
  avatar.replaceChildren(image);
}

function getGiphyImageUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:") {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const isMediaHost = hostname === "media.giphy.com"
    || hostname === "i.giphy.com"
    || /^media\d+\.giphy\.com$/.test(hostname);
  if (isMediaHost) {
    return /\.(gif|webp)$/i.test(url.pathname) ? url.href : null;
  }

  if (hostname !== "giphy.com" && hostname !== "www.giphy.com") {
    return null;
  }

  const mediaPathMatch = url.pathname.match(/^\/media\/([a-z0-9]+)\/.+\.(gif|webp)$/i);
  const embedMatch = url.pathname.match(/^\/embed\/([a-z0-9]+)\/?$/i);
  const lastPath = url.pathname.split("/").filter(Boolean).pop() || "";
  const slugMatch = lastPath.match(/-([a-z0-9]{6,})$/i);
  const directIdMatch = lastPath.match(/^([a-z0-9]{8,})$/i);
  const gifId = mediaPathMatch?.[1] || embedMatch?.[1] || slugMatch?.[1] || directIdMatch?.[1];

  return gifId ? `https://media.giphy.com/media/${gifId}/giphy.gif` : null;
}

const contactStatusLabels = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

function createPresenceIndicator(status) {
  const presence = document.createElement("span");
  presence.className = `friend-presence friend-presence-${status}`;

  const dot = document.createElement("span");
  dot.className = "friend-presence-dot";
  dot.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.textContent = contactStatusLabels[status];
  presence.append(dot, label);
  return presence;
}

function createDmEntry(contact, isGroup = false) {
  const { displayName, username, avatarColor, pinned = false, muted = false } = contact;
  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "dm-entry";
  entry.setAttribute("aria-label", isGroup
    ? `Open group chat ${displayName}${contact.isOwner ? ", you are the owner" : ""}`
    : `Message ${displayName}, username ${username}, status ${contactStatusLabels[contact.status]}`);

  entry.classList.add("has-context-menu");
  entry.classList.toggle("pinned", pinned);
  entry.classList.toggle("muted", muted);

  if (!isGroup) {
    entry.classList.add("has-username");
    entry.classList.toggle("is-active", username === activeChatUsername);
    entry.dataset.contactUsername = username;
    entry.dataset.contactName = displayName;
  }

  const avatarShell = document.createElement("span");
  avatarShell.className = "dm-avatar-shell";
  const avatar = createProfileAvatar(displayName, avatarColor);
  if (isGroup && contact.iconImage) {
    avatar.classList.add("has-group-icon-image");
    const image = document.createElement("img");
    image.className = "group-icon-image";
    image.src = contact.iconImage;
    image.alt = "";
    avatar.replaceChildren(image);
  }
  avatarShell.append(avatar);

  if (pinned) {
    const pinBadge = document.createElement("span");
    pinBadge.className = "dm-pin-indicator";
    pinBadge.setAttribute("aria-label", `${displayName} pinned`);
    pinBadge.title = "Pinned";
    pinBadge.textContent = "📌";
    avatarShell.append(pinBadge);
  }

  const details = document.createElement("span");
  details.className = "dm-contact-details";

  const label = document.createElement("span");
  label.className = "dm-name-flip";

  const displayNameLabel = document.createElement("span");
  displayNameLabel.className = "dm-display-name";
  displayNameLabel.textContent = displayName;
  label.append(displayNameLabel);

  if (!isGroup) {
    const usernameLabel = document.createElement("span");
    usernameLabel.className = "dm-username";
    usernameLabel.textContent = username;
    label.append(usernameLabel);
    details.append(label, createPresenceIndicator(contact.status));
  } else {
    details.append(label);
    if (contact.isOwner) {
      const ownerBadge = document.createElement("span");
      ownerBadge.className = "dm-owner-badge";
      ownerBadge.textContent = "Owner";
      details.append(ownerBadge);
    }
  }

  entry.append(avatarShell, details);
  return entry;
}

const demoGroupChats = [
  {
    id: "sunday-rehearsal",
    displayName: "Sunday Rehearsal",
    avatarColor: "#6b7280",
    defaultAvatarColor: "#6b7280",
    isOwner: true,
    ownerName: "You",
    members: ["You", "Tess Nguyen", "Ben Carter"],
  },
  {
    id: "gig-plans",
    displayName: "Gig Plans",
    avatarColor: "#a65d3b",
    defaultAvatarColor: "#a65d3b",
    ownerName: "Priya Shah",
    members: ["You", "Priya Shah", "Luis Romero"],
  },
  {
    id: "the-basement",
    displayName: "The Basement",
    avatarColor: "#356b62",
    defaultAvatarColor: "#356b62",
    ownerName: "Nora Williams",
    members: ["You", "Nora Williams", "Eli Brooks"],
  },
];
const demoContacts = [
  { displayName: "Tess Nguyen", username: "tess.n", status: "online", avatarColor: "#9b5b55", aboutMe: "Vocalist and songwriter. Always up for rehearsal.", pinned: true },
  { displayName: "Ben Carter", username: "bencarter_", status: "offline", avatarColor: "#526e57", aboutMe: "Guitar player, weekend hiker, and coffee fan." },
  { displayName: "Priya Shah", username: "priya.s", status: "idle", avatarColor: "#9a713e", aboutMe: "Making playlists and learning new instruments." },
  { displayName: "Luis Romero", username: "luisr92", status: "online", avatarColor: "#4b6e8a", aboutMe: "Drummer who likes a little bit of everything." },
  { displayName: "Nora Williams", username: "noraw", status: "offline", avatarColor: "#80638a", aboutMe: "Music lover and fan of cozy nights in." },
  { displayName: "Eli Brooks", username: "eli.brooks", status: "dnd", avatarColor: "#4c7773", aboutMe: "Bass, synths, and too many unfinished demos." },
  { displayName: "Maya Patel", username: "mayap", status: "online", avatarColor: "#a65d3b", aboutMe: "Singer, songwriter, and live music regular." },
  { displayName: "Chris O'Neill", username: "coneill", status: "offline", avatarColor: "#656b82", aboutMe: "Guitar and audio gear enthusiast." },
];
const demoConversations = {
  "tess.n": [
    { sender: "them", text: "Hey! How did rehearsal sound to you?" },
    { sender: "me", text: "Really good. The new arrangement is coming together." },
    { sender: "them", text: "Want to practice again this weekend?" },
  ],
  bencarter_: [
    { sender: "them", text: "I found a new guitar pedal you might like." },
    { sender: "me", text: "Send me the link when you get a chance!" },
  ],
  "priya.s": [
    { sender: "them", text: "I made a playlist for the next drive." },
    { sender: "me", text: "Perfect, I could use some new music." },
  ],
  luisr92: [
    { sender: "them", text: "Are we still on for band practice?" },
    { sender: "me", text: "Yep, see you there!" },
  ],
  noraw: [
    { sender: "them", text: "That show last night was so good." },
    { sender: "me", text: "Agreed. The encore was my favorite part." },
  ],
  "eli.brooks": [
    { sender: "them", text: "I finally finished that synth demo." },
    { sender: "me", text: "I'd love to hear it." },
  ],
  mayap: [
    { sender: "them", text: "Do you know any good live music spots nearby?" },
    { sender: "me", text: "There's a small venue downtown that has great shows." },
  ],
  coneill: [
    { sender: "them", text: "What do you think of this new amp setup?" },
    { sender: "me", text: "It sounds awesome, really warm tone." },
  ],
};
const demoPendingRequests = [
  { displayName: "Jordan Lee", username: "jordanlee", id: "0000030658", avatarColor: "#4b7388" },
  { displayName: "Avery Morgan", username: "avery.m", id: "0000031842", avatarColor: "#956b78" },
  { displayName: "Sam Rivera", username: "samrivera", id: "0000042719", avatarColor: "#6d8050" },
];
const demoBlockedAccounts = [];
const demoObjectUrls = new Set();
let activeChatUsername = null;

function getSortedFriends() {
  return [...demoContacts].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
}

function getSavedAccountSettings() {
  try {
    const storedSettings = localStorage.getItem("bandcast.accountSettings");
    if (!storedSettings) {
      return {};
    }

    const parsedSettings = JSON.parse(storedSettings);
    if (!parsedSettings || typeof parsedSettings !== "object" || Array.isArray(parsedSettings)) {
      throw new TypeError("Saved account settings must be an object.");
    }
    return parsedSettings;
  } catch (error) {
    console.error("Unable to load saved account settings.", error);
    return {};
  }
}

let activeProfileTrigger = null;

function closeProfilePopover(restoreFocus = false) {
  document.querySelector(".profile-popover")?.remove();
  if (activeProfileTrigger instanceof HTMLElement) {
    activeProfileTrigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
      activeProfileTrigger.focus();
    }
  }
  activeProfileTrigger = null;
}

function showProfilePopover(profile, trigger, anchor = trigger) {
  closeProfilePopover();

  const popover = document.createElement("section");
  popover.className = "profile-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-labelledby", "profile-popover-title");

  const header = document.createElement("div");
  header.className = "profile-popover-header";

  const avatar = createProfileAvatar(
    profile.displayName,
    profile.avatarColor,
    "profile-avatar profile-popover-avatar",
  );
  setProfileAvatarImage(avatar, profile.avatarImage);
  header.append(avatar);

  const identity = document.createElement("div");
  identity.className = "profile-popover-identity";

  const name = document.createElement("h2");
  name.className = "profile-popover-name";
  name.id = "profile-popover-title";
  name.textContent = profile.displayName;

  const username = document.createElement("p");
  username.className = "profile-popover-username";
  username.textContent = `@${profile.username}`;

  identity.append(name, username);

  header.append(identity);

  const about = document.createElement("div");
  about.className = "profile-popover-about";

  const aboutHeading = document.createElement("h3");
  aboutHeading.textContent = "About me";

  const aboutText = document.createElement("p");
  aboutText.textContent = profile.aboutMe?.trim() || "No bio added yet.";
  about.append(aboutHeading, aboutText);

  popover.append(header, about);
  if (profile.isSelf) {
    const editProfile = document.createElement("a");
    editProfile.className = "profile-popover-edit";
    editProfile.href = "settings.html#profile";
    editProfile.setAttribute("aria-label", "Edit profile");
    editProfile.title = "Edit profile";

    const editIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    editIcon.setAttribute("viewBox", "0 0 24 24");
    editIcon.setAttribute("aria-hidden", "true");
    const editPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    editPath.setAttribute(
      "d",
      "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z",
    );
    editIcon.append(editPath);
    editProfile.append(editIcon);
    popover.append(editProfile);
  } else {
    const messageButton = document.createElement("button");
    messageButton.className = "profile-popover-message";
    messageButton.type = "button";
    messageButton.textContent = "Message";
    messageButton.addEventListener("click", () => openFriendChat(profile));
    popover.append(messageButton);
  }

  document.body.append(popover);

  if (trigger instanceof HTMLElement) {
    trigger.setAttribute("aria-expanded", "true");
    activeProfileTrigger = trigger;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const left = Math.max(12, Math.min(anchorRect.left, window.innerWidth - popoverRect.width - 12));
  const above = anchorRect.top - popoverRect.height - 10;
  const top = above >= 12
    ? above
    : Math.min(anchorRect.bottom + 10, window.innerHeight - popoverRect.height - 12);
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(12, top)}px`;
}

function getSortedGroupChats() {
  return [...demoGroupChats].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
}

function hideContextMenu() {
  document.querySelectorAll(".dm-context-menu").forEach((menu) => menu.remove());
}

function handleFriendContextAction(action, contact) {
  switch (action) {
    case "view-profile": {
      const entry = Array.from(document.querySelectorAll(".dm-entry[data-contact-username]"))
        .find((item) => item.dataset.contactUsername === contact.username);
      if (entry instanceof HTMLElement) {
        showProfilePopover(contact, null, entry);
      }
      break;
    }
    case "voice-call":
      window.alert(`Starting voice call with ${contact.displayName}`);
      break;
    case "toggle-pin":
      contact.pinned = !contact.pinned;
      renderDmList();
      break;
    case "toggle-mute":
      contact.muted = !contact.muted;
      renderDmList();
      break;
    case "remove-friend":
      showRemoveFriendDialog(contact);
      break;
    case "block-friend":
      showBlockConfirmation(contact, () => {
        const contactIndex = demoContacts.findIndex((entry) => entry.username === contact.username);
        if (contactIndex >= 0) {
          demoContacts.splice(contactIndex, 1);
          demoBlockedAccounts.push(contact);
          renderDmList();
        }
      });
      break;
    default:
      break;
  }
  hideContextMenu();
}

function showRemoveFriendDialog(contact) {
  document.querySelector(".friend-confirmation-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "friend-confirmation-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  const dialog = document.createElement("section");
  dialog.className = "friend-confirmation-dialog";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "friend-confirmation-title");
  dialog.setAttribute("aria-describedby", "friend-confirmation-message");

  const title = document.createElement("h2");
  title.className = "friend-confirmation-title";
  title.id = "friend-confirmation-title";
  title.textContent = "Remove Friend";

  const message = document.createElement("p");
  message.className = "friend-confirmation-message";
  message.id = "friend-confirmation-message";
  message.textContent = `Are you sure you want to remove ${contact.displayName} from your friends?`;

  const actions = document.createElement("div");
  actions.className = "friend-confirmation-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "friend-confirmation-cancel";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => overlay.remove());

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "friend-confirmation-remove";
  removeButton.textContent = "Remove Friend";
  removeButton.addEventListener("click", () => {
    const contactIndex = demoContacts.findIndex((entry) => entry.username === contact.username);
    if (contactIndex >= 0) {
      demoContacts.splice(contactIndex, 1);
      renderDmList();
    }
    overlay.remove();
  });

  actions.append(cancelButton, removeButton);
  dialog.append(title, message, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  cancelButton.focus();
}

function showContextMenu(event, actions, onAction) {
  hideContextMenu();
  const menu = document.createElement("div");
  menu.className = "dm-context-menu";
  menu.setAttribute("role", "menu");

  actions.forEach(({ label, action }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "dm-context-menu-item";
    item.textContent = label;
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", () => onAction(action));
    menu.append(item);
  });

  document.body.append(menu);

  const menuWidth = menu.offsetWidth || 200;
  const menuHeight = menu.offsetHeight || 180;
  const x = Math.max(12, Math.min(event.clientX, window.innerWidth - menuWidth - 12));
  const y = Math.max(12, Math.min(event.clientY, window.innerHeight - menuHeight - 12));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

function showFriendContextMenu(event, contact) {
  const actions = [
    { label: "View Profile", action: "view-profile" },
    { label: "Start Voice Call", action: "voice-call" },
    { label: contact.pinned ? "Unpin Profile" : "Pin Profile", action: "toggle-pin" },
    { label: contact.muted ? "Unmute" : "Mute", action: "toggle-mute" },
    { label: "Block", action: "block-friend" },
    { label: "Remove Friend", action: "remove-friend" },
  ];
  showContextMenu(event, actions, (action) => handleFriendContextAction(action, contact));
}

function createDemoDialog(titleText, messageText) {
  document.querySelector(".friend-confirmation-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "friend-confirmation-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  const dialog = document.createElement("section");
  dialog.className = "friend-confirmation-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "demo-dialog-title");

  const title = document.createElement("h2");
  title.className = "friend-confirmation-title";
  title.id = "demo-dialog-title";
  title.textContent = titleText;
  dialog.append(title);

  if (messageText) {
    const message = document.createElement("p");
    message.className = "friend-confirmation-message group-dialog-message";
    message.textContent = messageText;
    dialog.append(message);
  }

  overlay.append(dialog);
  document.body.append(overlay);
  return { overlay, dialog };
}

function createDemoDialogButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function showBlockConfirmation(account, onConfirm) {
  const { overlay, dialog } = createDemoDialog(
    `Block ${account.displayName}?`,
    `Are you sure you want to block ${account.displayName}?`,
  );
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-describedby", "block-confirmation-message");
  const message = dialog.querySelector(".group-dialog-message");
  if (message instanceof HTMLElement) {
    message.id = "block-confirmation-message";
  }

  const actions = document.createElement("div");
  actions.className = "friend-confirmation-actions";
  const cancelButton = createDemoDialogButton("Cancel", "friend-confirmation-cancel", () => overlay.remove());
  const blockButton = createDemoDialogButton("Block", "friend-confirmation-remove", () => {
    onConfirm();
    overlay.remove();
  });
  actions.append(cancelButton, blockButton);
  dialog.append(actions);
  cancelButton.focus();
}

function showPendingRequestsView() {
  const view = document.querySelector("[data-friend-view]");
  const pendingButton = document.querySelector("[data-open-pending]");
  if (!(view instanceof HTMLElement)) {
    return;
  }

  view.dataset.view = "pending";
  view.classList.remove("is-chat-view");

  const heading = document.createElement("h1");
  heading.className = "friend-view-title";
  heading.id = "friend-view-title";
  heading.textContent = "Pending";

  const requests = document.createElement("ul");
  requests.className = "friend-pending-list";

  demoPendingRequests.forEach((request) => {
    const item = document.createElement("li");
    item.className = "friend-pending-item";

    const avatar = createProfileAvatar(
      request.displayName,
      request.avatarColor,
      "profile-avatar friend-pending-avatar",
    );

    const identity = document.createElement("div");
    identity.className = "friend-pending-identity";

    const name = document.createElement("strong");
    name.textContent = request.displayName;

    const details = document.createElement("span");
    details.className = "friend-pending-details";
    details.textContent = `@${request.username}`;

    identity.append(name, details);

    const actions = document.createElement("div");
    actions.className = "friend-pending-actions";
    [
      { label: "Accept", action: "accept", className: "friend-pending-accept" },
      { label: "Block", action: "block", className: "friend-pending-block" },
      { label: "Deny", action: "deny", className: "friend-pending-deny" },
    ].forEach(({ label, action, className }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      button.setAttribute("aria-label", `${label} friend request from ${request.displayName}`);
      button.addEventListener("click", () => {
        if (action === "block") {
          showBlockConfirmation(request, () => handlePendingRequest(action, request));
        } else {
          handlePendingRequest(action, request);
        }
      });
      actions.append(button);
    });

    item.append(avatar, identity, actions);
    requests.append(item);
  });

  if (demoPendingRequests.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "friend-view-description";
    emptyState.textContent = "No pending friend requests.";
    view.replaceChildren(heading, emptyState);
  } else {
    view.replaceChildren(heading, requests);
  }
  view.hidden = false;
  view.focus();
  if (pendingButton instanceof HTMLButtonElement) {
    pendingButton.setAttribute("aria-pressed", "true");
  }
}

function togglePendingRequestsView() {
  const view = document.querySelector("[data-friend-view]");
  const pendingButton = document.querySelector("[data-open-pending]");
  if (!(view instanceof HTMLElement)) {
    return;
  }

  if (view.hidden || view.dataset.view !== "pending") {
    showPendingRequestsView();
    return;
  }

  view.hidden = true;
  if (pendingButton instanceof HTMLButtonElement) {
    pendingButton.setAttribute("aria-pressed", "false");
    pendingButton.focus();
  }
}

function createChatMessageElement(message, contact) {
  const row = document.createElement("article");
  row.className = `chat-message chat-message-${message.sender === "me" ? "outgoing" : "incoming"}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-message-bubble";
  if (message.type === "gif") {
    row.classList.add("chat-message-media");
    const image = document.createElement("img");
    image.className = "chat-gif";
    image.src = message.gifUrl;
    image.alt = message.sender === "me" ? "GIF you sent" : `GIF from ${contact.displayName}`;
    image.loading = "lazy";
    image.addEventListener("error", () => {
      const link = document.createElement("a");
      link.href = message.originalUrl || message.gifUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open GIF on GIPHY";
      bubble.replaceChildren(link);
    }, { once: true });
    bubble.append(image);
  } else if (message.type === "attachment") {
    const isImage = message.mimeType.startsWith("image/")
      || /\.(png|jpe?g|gif|webp|bmp)$/i.test(message.fileName);
    const isVideo = message.mimeType.startsWith("video/")
      || /\.(mp4|webm|mov|m4v|ogv)$/i.test(message.fileName);
    if (isImage || isVideo) {
      row.classList.add("chat-message-media");
      const media = document.createElement(isVideo ? "video" : "img");
      media.className = isVideo ? "chat-attachment-video" : "chat-attachment-image";
      media.src = message.fileUrl;
      media.setAttribute("aria-label", message.fileName);
      if (isVideo) {
        media.controls = true;
        media.preload = "metadata";
      } else {
        media.alt = message.fileName;
        media.loading = "lazy";
      }
      bubble.append(media);
    } else {
      const link = document.createElement("a");
      link.className = "chat-file-link";
      link.href = message.fileUrl;
      link.download = message.fileName;
      link.textContent = `${message.fileName} (${formatFileSize(message.fileSize)})`;
      bubble.append(link);
    }
  } else {
    const text = document.createElement("p");
    text.className = "chat-message-text";
    text.textContent = message.text;
    bubble.append(text);
  }

  row.append(bubble);
  return row;
}

function formatFileSize(size) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function openFriendChat(contact) {
  const view = document.querySelector("[data-friend-view]");
  if (!(view instanceof HTMLElement)) {
    return;
  }

  const isSameOpenChat = !view.hidden
    && view.dataset.view === "chat"
    && activeChatUsername === contact.username;
  activeChatUsername = contact.username;
  closeProfilePopover();
  hideContextMenu();
  if (isSameOpenChat) {
    activeChatUsername = null;
    view.hidden = true;
    view.classList.remove("is-chat-view");
    view.dataset.view = "";
    view.replaceChildren();
    document.querySelectorAll(".dm-entry[data-contact-username]").forEach((entry) => {
      entry.classList.remove("is-active");
    });
    const pendingButton = document.querySelector("[data-open-pending]");
    if (pendingButton instanceof HTMLButtonElement) {
      pendingButton.setAttribute("aria-pressed", "false");
    }
    return;
  }

  view.dataset.view = "chat";
  view.classList.add("is-chat-view");
  view.hidden = false;
  view.replaceChildren();

  const header = document.createElement("header");
  header.className = "chat-header";
  const avatar = createProfileAvatar(
    contact.displayName,
    contact.avatarColor,
    "profile-avatar chat-header-avatar",
  );
  const identity = document.createElement("div");
  identity.className = "chat-header-identity";
  const title = document.createElement("h1");
  title.className = "friend-view-title";
  title.id = "friend-view-title";
  title.textContent = contact.displayName;
  identity.append(title);
  header.append(avatar, identity);

  const messageList = document.createElement("div");
  messageList.className = "chat-message-list";
  messageList.setAttribute("role", "log");
  messageList.setAttribute("aria-label", `Chat with ${contact.displayName}`);
  messageList.setAttribute("aria-live", "polite");

  if (!demoConversations[contact.username]) {
    demoConversations[contact.username] = [
      { sender: "them", text: "Hey! Thanks for connecting." },
    ];
  }
  demoConversations[contact.username].forEach((message) => {
    messageList.append(createChatMessageElement(message, contact));
  });

  const composer = document.createElement("form");
  composer.className = "chat-composer";
  const input = document.createElement("textarea");
  input.className = "chat-composer-input";
  input.name = "message";
  input.rows = 1;
  input.maxLength = 1000;
  input.setAttribute("aria-label", `Message ${contact.displayName}`);
  input.placeholder = `Message ${contact.displayName}`;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.hidden = true;
  fileInput.setAttribute("aria-label", "Choose files to send");

  const attachButton = document.createElement("button");
  attachButton.type = "button";
  attachButton.className = "chat-attach-button";
  attachButton.setAttribute("aria-label", "Attach files");
  const attachIcon = document.createElement("span");
  attachIcon.classList.add("chat-attach-icon");
  attachIcon.setAttribute("aria-hidden", "true");
  attachButton.append(attachIcon);
  const restoreComposerFocus = () => {
    composer.classList.remove("is-expanded");
    input.focus();
  };
  attachButton.addEventListener("click", () => {
    composer.classList.add("is-expanded");
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    Array.from(fileInput.files || []).forEach((file) => {
      const fileUrl = URL.createObjectURL(file);
      demoObjectUrls.add(fileUrl);
      const message = {
        sender: "me",
        type: "attachment",
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        fileUrl,
      };
      demoConversations[contact.username].push(message);
      messageList.append(createChatMessageElement(message, contact));
    });
    fileInput.value = "";
    messageList.scrollTop = messageList.scrollHeight;
    restoreComposerFocus();
  });
  fileInput.addEventListener("cancel", restoreComposerFocus);

  const gifButton = document.createElement("button");
  gifButton.type = "button";
  gifButton.className = "chat-gif-button";
  gifButton.textContent = "GIF";
  gifButton.setAttribute("aria-label", "Send a GIF");
  gifButton.addEventListener("click", () => {
    composer.classList.add("is-expanded");
    showGifLinkDialog(contact, input, composer);
  });

  composer.append(attachButton, input, gifButton, fileInput);
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      return;
    }

    const gifUrl = getGiphyImageUrl(text);
    const message = gifUrl
      ? { sender: "me", type: "gif", gifUrl, originalUrl: text }
      : { sender: "me", type: "text", text };
    demoConversations[contact.username].push(message);
    messageList.append(createChatMessageElement(message, contact));
    messageList.scrollTop = messageList.scrollHeight;
    input.value = "";
    input.focus();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });

  view.append(header, messageList, composer);
  messageList.scrollTop = messageList.scrollHeight;
  input.focus();
  document.querySelectorAll(".dm-entry[data-contact-username]").forEach((entry) => {
    entry.classList.toggle("is-active", entry.dataset.contactUsername === contact.username);
  });

  const pendingButton = document.querySelector("[data-open-pending]");
  if (pendingButton instanceof HTMLButtonElement) {
    pendingButton.setAttribute("aria-pressed", "false");
  }
}

function showGifLinkDialog(contact, chatInput, composer) {
  const { overlay, dialog } = createDemoDialog("Send a GIF", "Paste a GIPHY link to share it in chat.");
  const restoreComposerFocus = () => {
    composer.classList.remove("is-expanded");
    chatInput.focus();
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      restoreComposerFocus();
    }
  });
  const form = document.createElement("form");
  form.className = "friend-search-form";

  const label = document.createElement("label");
  label.className = "group-edit-label";
  label.htmlFor = "chat-gif-link";
  label.textContent = "GIPHY link";

  const input = document.createElement("input");
  input.className = "group-dialog-input";
  input.id = "chat-gif-link";
  input.name = "gifLink";
  input.type = "url";
  input.required = true;
  input.autocomplete = "url";

  const error = document.createElement("p");
  error.className = "group-edit-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "friend-confirmation-actions";
  const cancelButton = createDemoDialogButton("Cancel", "friend-confirmation-cancel", () => {
    overlay.remove();
    restoreComposerFocus();
  });
  const sendButton = document.createElement("button");
  sendButton.type = "submit";
  sendButton.className = "friend-confirmation-save";
  sendButton.textContent = "Send GIF";
  actions.append(cancelButton, sendButton);

  form.append(label, input, error, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const gifUrl = getGiphyImageUrl(input.value);
    if (!gifUrl) {
      error.textContent = "Enter a valid GIPHY link.";
      error.hidden = false;
      return;
    }

    const message = {
      sender: "me",
      type: "gif",
      gifUrl,
      originalUrl: input.value.trim(),
    };
    demoConversations[contact.username].push(message);
    const messageList = document.querySelector(".chat-message-list");
    if (messageList instanceof HTMLElement && activeChatUsername === contact.username) {
      messageList.append(createChatMessageElement(message, contact));
      messageList.scrollTop = messageList.scrollHeight;
    }
    overlay.remove();
    restoreComposerFocus();
  });

  dialog.append(form);
  input.focus();
}

function handlePendingRequest(action, request) {
  const requestIndex = demoPendingRequests.findIndex((entry) => entry.username === request.username);
  if (requestIndex < 0) {
    return;
  }

  const [handledRequest] = demoPendingRequests.splice(requestIndex, 1);
  if (action === "accept") {
    if (!demoContacts.some((contact) => contact.username === handledRequest.username)) {
      demoContacts.push({
        displayName: handledRequest.displayName,
        username: handledRequest.username,
        status: "offline",
        avatarColor: handledRequest.avatarColor,
        aboutMe: "",
        id: handledRequest.id,
      });
    }
    renderDmList();
  } else if (action === "block") {
    demoBlockedAccounts.push(handledRequest);
  }

  showPendingRequestsView();
}

function showAddFriendDialog() {
  const { overlay, dialog } = createDemoDialog("Add a friend", "Search for someone by username or ID.");
  const form = document.createElement("form");
  form.className = "friend-search-form";

  const label = document.createElement("label");
  label.className = "group-edit-label";
  label.htmlFor = "friend-search-input";
  label.textContent = "Username or ID";

  const input = document.createElement("input");
  input.className = "group-dialog-input";
  input.id = "friend-search-input";
  input.name = "friend";
  input.type = "text";
  input.autocomplete = "off";
  input.maxLength = 64;
  input.required = true;

  const error = document.createElement("p");
  error.className = "group-edit-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "friend-confirmation-actions";
  const cancelButton = createDemoDialogButton("Cancel", "friend-confirmation-cancel", () => overlay.remove());
  const searchButton = document.createElement("button");
  searchButton.type = "submit";
  searchButton.className = "friend-confirmation-save";
  searchButton.textContent = "Search";
  actions.append(cancelButton, searchButton);

  form.append(label, input, error, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.textContent = "You cannot do this in the demo.";
    error.hidden = false;
  });

  dialog.append(form);
  input.focus();
}

function showGroupMessageDialog(title, message, inviteLink) {
  const { overlay, dialog } = createDemoDialog(title, message);

  if (inviteLink) {
    const input = document.createElement("input");
    input.className = "group-dialog-input";
    input.type = "text";
    input.value = inviteLink;
    input.readOnly = true;
    input.setAttribute("aria-label", "Group invite link");
    input.addEventListener("focus", () => input.select());
    input.addEventListener("click", () => input.select());
    dialog.append(input);
  }

  const actions = document.createElement("div");
  actions.className = "friend-confirmation-actions";
  const closeButton = createDemoDialogButton("Close", "friend-confirmation-cancel", () => overlay.remove());
  actions.append(closeButton);
  dialog.append(actions);
  closeButton.focus();
}

function showGroupEditDialog(group) {
  const { overlay, dialog } = createDemoDialog("Edit Group", "Choose a name for this group.");

  const form = document.createElement("form");
  form.className = "group-edit-form";

  const label = document.createElement("label");
  label.className = "group-edit-label";
  label.textContent = "Group name";

  const input = document.createElement("input");
  input.className = "group-dialog-input";
  input.type = "text";
  input.maxLength = 40;
  input.value = group.displayName;
  label.append(input);

  const error = document.createElement("p");
  error.className = "group-edit-error";
  error.setAttribute("aria-live", "polite");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "friend-confirmation-actions";
  const cancelButton = createDemoDialogButton("Cancel", "friend-confirmation-cancel", () => overlay.remove());
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "friend-confirmation-save";
  saveButton.textContent = "Save";
  actions.append(cancelButton, saveButton);

  form.append(label, error, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      error.textContent = "Group name cannot be empty.";
      error.hidden = false;
      input.focus();
      return;
    }

    group.displayName = value;
    overlay.remove();
    renderDmList();
  });

  dialog.append(form);
  input.focus();
  input.select();
}

function showGroupIconDialog(group) {
  const { overlay, dialog } = createDemoDialog(
    "Change Group Icon",
    "Choose a background color or upload an image. Animated GIFs are supported.",
  );
  const form = document.createElement("form");
  form.className = "group-icon-editor";

  const preview = document.createElement("span");
  preview.className = "profile-avatar group-icon-preview";
  preview.style.setProperty("--avatar-color", group.avatarColor);

  let selectedImage = group.iconImage || "";
  const updatePreview = () => {
    preview.classList.toggle("has-group-icon-image", Boolean(selectedImage));
    preview.replaceChildren();
    if (selectedImage) {
      const image = document.createElement("img");
      image.className = "group-icon-image";
      image.src = selectedImage;
      image.alt = "";
      preview.append(image);
    } else {
      preview.textContent = getProfileInitial(group.displayName);
    }
  };
  updatePreview();
  form.append(preview);

  const colorLabel = document.createElement("div");
  colorLabel.className = "group-edit-label";
  colorLabel.textContent = "Background color";
  const colorControl = document.createElement("span");
  colorControl.className = "group-icon-control";
  const colorButton = document.createElement("button");
  colorButton.type = "button";
  colorButton.className = "group-icon-control-button group-icon-color-button";
  colorButton.tabIndex = -1;
  colorButton.setAttribute("aria-hidden", "true");
  const colorSwatch = document.createElement("span");
  colorSwatch.className = "group-icon-color-swatch";
  const colorButtonText = document.createElement("span");
  colorButtonText.textContent = "Choose color";
  colorButton.append(colorSwatch, colorButtonText);
  const colorInput = document.createElement("input");
  colorInput.className = "group-icon-control-input";
  colorInput.type = "color";
  colorInput.value = group.avatarColor;
  colorInput.setAttribute("aria-label", "Group icon background color");
  colorSwatch.style.backgroundColor = colorInput.value;
  colorInput.addEventListener("input", () => {
    preview.style.setProperty("--avatar-color", colorInput.value);
    colorSwatch.style.backgroundColor = colorInput.value;
  });
  colorControl.append(colorButton, colorInput);
  colorLabel.append(colorControl);

  const imageLabel = document.createElement("div");
  imageLabel.className = "group-edit-label";
  imageLabel.textContent = "Group image";
  const imageControl = document.createElement("span");
  imageControl.className = "group-icon-control";
  const imageButton = document.createElement("button");
  imageButton.type = "button";
  imageButton.className = "group-icon-control-button group-icon-file-button";
  imageButton.tabIndex = -1;
  imageButton.setAttribute("aria-hidden", "true");
  imageButton.textContent = "Select image";
  const imageInput = document.createElement("input");
  imageInput.className = "group-icon-control-input";
  imageInput.type = "file";
  imageInput.accept = "image/*";
  imageInput.setAttribute("aria-label", "Choose a group image, including GIF");
  const imageName = document.createElement("span");
  imageName.className = "group-icon-file-name";
  imageName.textContent = "No image selected";

  const error = document.createElement("p");
  error.className = "group-edit-error";
  error.setAttribute("aria-live", "polite");
  error.hidden = true;
  imageInput.addEventListener("change", () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      error.textContent = "Choose a valid image file.";
      error.hidden = false;
      imageName.textContent = "No image selected";
      imageInput.value = "";
      return;
    }

    error.hidden = true;
    imageName.textContent = file.name;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        error.textContent = "Could not read this image. Choose a different file.";
        error.hidden = false;
        return;
      }
      selectedImage = reader.result;
      updatePreview();
    });
    reader.addEventListener("error", () => {
      error.textContent = "Could not read this image. Choose a different file.";
      error.hidden = false;
    });
    reader.readAsDataURL(file);
  });
  imageControl.append(imageButton, imageInput);
  imageLabel.append(imageControl, imageName);

  const actions = document.createElement("div");
  actions.className = "friend-confirmation-actions";
  const defaultButton = createDemoDialogButton("Reset to default", "friend-confirmation-default", () => {
    group.avatarColor = group.defaultAvatarColor;
    delete group.iconImage;
    overlay.remove();
    renderDmList();
  });
  const cancelButton = createDemoDialogButton("Cancel", "friend-confirmation-cancel", () => overlay.remove());
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "friend-confirmation-save";
  saveButton.textContent = "Save";
  actions.append(defaultButton, cancelButton, saveButton);

  form.append(colorLabel, imageLabel, error, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    group.avatarColor = colorInput.value;
    if (selectedImage) {
      group.iconImage = selectedImage;
    } else {
      delete group.iconImage;
    }
    overlay.remove();
    renderDmList();
  });

  dialog.append(form);
  colorInput.focus();
}

function showLeaveGroupDialog(group) {
  const { overlay, dialog } = createDemoDialog(
    "Leave Group",
    `Are you sure you want to leave ${group.displayName}?`,
  );

  const actions = document.createElement("div");
  actions.className = "friend-confirmation-actions";
  const cancelButton = createDemoDialogButton("Cancel", "friend-confirmation-cancel", () => overlay.remove());
  const leaveButton = createDemoDialogButton("Leave Group", "friend-confirmation-remove", () => {
    const groupIndex = demoGroupChats.findIndex((entry) => entry.id === group.id);
    if (groupIndex >= 0) {
      demoGroupChats.splice(groupIndex, 1);
      renderDmList();
    }
    overlay.remove();
  });
  actions.append(cancelButton, leaveButton);
  dialog.append(actions);
  cancelButton.focus();
}

async function copyGroupInviteLink(group) {
  const inviteLink = `https://bandcast.net/invite/${encodeURIComponent(group.id)}`;

  if (!navigator.clipboard?.writeText) {
    showGroupMessageDialog("Copy Invite Link", "Select and copy this invite link:", inviteLink);
    return;
  }

  try {
    await navigator.clipboard.writeText(inviteLink);
  } catch {
    showGroupMessageDialog("Copy Invite Link", "Clipboard access failed. Select and copy this invite link:", inviteLink);
    return;
  }

  showGroupMessageDialog("Invite Link Copied", "The invite link was copied to your clipboard.");
}

function handleGroupContextAction(action, group) {
  switch (action) {
    case "view-members":
      showGroupMessageDialog(
        `Members of ${group.displayName}`,
        group.members.map((member) => member === group.ownerName ? `${member} (Owner)` : member).join("\n"),
      );
      break;
    case "toggle-mute":
      group.muted = !group.muted;
      renderDmList();
      break;
    case "toggle-pin":
      group.pinned = !group.pinned;
      renderDmList();
      break;
    case "copy-invite-link":
      copyGroupInviteLink(group);
      break;
    case "leave-group":
      showLeaveGroupDialog(group);
      break;
    case "edit-group":
      showGroupEditDialog(group);
      break;
    case "change-group-icon":
      showGroupIconDialog(group);
      break;
    default:
      break;
  }
  hideContextMenu();
}

function showGroupContextMenu(event, group) {
  const actions = [
    { label: "View Members", action: "view-members" },
    { label: group.muted ? "Unmute notifications" : "Mute notifications", action: "toggle-mute" },
    { label: group.pinned ? "Unpin" : "Pin", action: "toggle-pin" },
    { label: "Copy invite link", action: "copy-invite-link" },
  ];

  if (group.isOwner) {
    actions.push(
      { label: "Edit Group", action: "edit-group" },
      { label: "Change group icon", action: "change-group-icon" },
    );
  } else {
    actions.push({ label: "Leave Group", action: "leave-group" });
  }

  showContextMenu(event, actions, (action) => handleGroupContextAction(action, group));
}

function renderDmList() {
  const dmList = document.querySelector("[data-dm-list]");

  if (!(dmList instanceof HTMLElement)) {
    return;
  }

  closeProfilePopover();
  dmList.replaceChildren();

  const groupHeading = document.createElement("h3");
  groupHeading.className = "dm-subheading";
  groupHeading.textContent = "Group Chats";
  dmList.append(groupHeading);
  getSortedGroupChats().forEach((group) => {
    const entry = createDmEntry(group, true);
    entry.classList.add("has-group-context");
    entry.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showGroupContextMenu(event, group);
    });
    dmList.append(entry);
  });

  const friendsHeading = document.createElement("h3");
  friendsHeading.className = "dm-subheading";
  friendsHeading.textContent = "Friends";
  dmList.append(friendsHeading);
  getSortedFriends().forEach((contact) => {
    const entry = createDmEntry(contact);
    entry.addEventListener("click", () => openFriendChat(contact));
    entry.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showFriendContextMenu(event, contact);
    });
    dmList.append(entry);
  });
}

const dmList = document.querySelector("[data-dm-list]");

if (dmList instanceof HTMLElement) {
  renderDmList();
}

const pendingButton = document.querySelector("[data-open-pending]");
pendingButton?.addEventListener("click", togglePendingRequestsView);

const addFriendButton = document.querySelector("[data-open-add-friend]");
addFriendButton?.addEventListener("click", showAddFriendDialog);

document.addEventListener("click", (event) => {
  if (!event.target.closest(".dm-context-menu") && !event.target.closest(".dm-entry.has-context-menu")) {
    hideContextMenu();
  }
  if (event.target instanceof Element
    && !event.target.closest(".profile-popover")
    && !event.target.closest("[data-profile-trigger]")
    && !event.target.closest(".dm-context-menu")) {
    closeProfilePopover();
  }
});

document.addEventListener("contextmenu", (event) => {
  if (!event.target.closest(".dm-entry.has-context-menu")) {
    hideContextMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideContextMenu();
    closeProfilePopover(true);
    document.querySelector(".friend-confirmation-overlay")?.remove();
  }
});

window.addEventListener("beforeunload", () => {
  demoObjectUrls.forEach((url) => URL.revokeObjectURL(url));
});

const savedAccountSettings = getSavedAccountSettings();
const savedProfile = savedAccountSettings.account || {};
const profileAvatar = document.querySelector(".profile-avatar[data-avatar-name]");
const profileInfo = document.querySelector(".profile-info");
const profileName = document.querySelector(".profile-name");
const profileUsername = document.querySelector(".status-username");
const displayName = typeof savedProfile.displayName === "string" && savedProfile.displayName.trim()
  ? savedProfile.displayName.trim()
  : profileAvatar instanceof HTMLElement ? profileAvatar.dataset.avatarName || "" : "";
const username = typeof savedProfile.username === "string" && savedProfile.username.trim()
  ? savedProfile.username.trim()
  : "HunterScott323";
const savedPublicProfile = savedAccountSettings.profile || {};
const profileAvatarColor = typeof savedPublicProfile.avatarColor === "string"
  && /^#[0-9a-f]{6}$/i.test(savedPublicProfile.avatarColor)
  ? savedPublicProfile.avatarColor
  : "#5865f2";
const profileAvatarImage = typeof savedPublicProfile.avatarImage === "string"
  && savedPublicProfile.avatarImage.startsWith("data:image/")
  ? savedPublicProfile.avatarImage
  : "";

if (profileAvatar instanceof HTMLElement) {
  profileAvatar.dataset.avatarName = displayName;
  profileAvatar.dataset.avatarColor = profileAvatarColor;
}
if (profileInfo instanceof HTMLButtonElement) {
  profileInfo.setAttribute("aria-label", `Profile for ${username}`);
  profileInfo.dataset.profileTrigger = "self";
  profileInfo.setAttribute("aria-haspopup", "dialog");
  profileInfo.setAttribute("aria-expanded", "false");
  const ownProfile = {
    isSelf: true,
    displayName,
    username,
    status: "online",
    avatarColor: profileAvatarColor,
    avatarImage: profileAvatarImage,
    aboutMe: typeof savedPublicProfile.aboutMe === "string" ? savedPublicProfile.aboutMe : "",
  };
  profileInfo.addEventListener("click", () => {
    if (activeProfileTrigger === profileInfo) {
      closeProfilePopover();
      return;
    }
    showProfilePopover(ownProfile, profileInfo, profileInfo.closest(".profile-dock") || profileInfo);
  });
}
if (profileName instanceof HTMLElement) {
  profileName.textContent = displayName;
}
if (profileUsername instanceof HTMLElement) {
  profileUsername.textContent = username;
}

const appearanceSettings = savedAccountSettings.appearance || {};
document.documentElement.classList.toggle("compact-interface", appearanceSettings.density === "compact");
document.documentElement.classList.toggle("reduce-motion", appearanceSettings.reduceMotion === true);

document.querySelectorAll(".profile-avatar[data-avatar-name]").forEach((avatar) => {
  if (avatar instanceof HTMLElement) {
    setProfileAvatar(avatar, avatar.dataset.avatarName || "", avatar.dataset.avatarColor);
  }
});
if (profileAvatar instanceof HTMLElement) {
  setProfileAvatarImage(profileAvatar, profileAvatarImage);
}

const settingsButton = document.querySelector(".settings-button");

if (settingsButton instanceof HTMLButtonElement) {
  settingsButton.addEventListener("click", () => {
    window.location.href = "settings.html";
  });
}

const micToggle = document.querySelector("[data-mic-toggle]");

if (micToggle instanceof HTMLButtonElement) {
  micToggle.addEventListener("click", () => {
    const isMuted = micToggle.getAttribute("aria-pressed") !== "true";
    micToggle.setAttribute("aria-pressed", String(isMuted));
    micToggle.setAttribute("aria-label", isMuted ? "Unmute microphone" : "Mute microphone");
  });
}
