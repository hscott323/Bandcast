function getProfileInitial(name) {
  const firstCharacter = Array.from(name.trim())[0];
  return firstCharacter ? Array.from(firstCharacter.toUpperCase())[0] || "?" : "?";
}

function getAvatarColor(initial) {
  // Keep this deterministic so the same initials get the same color in the backend.
  const codePoint = initial.codePointAt(0) || 63;
  const hue = (codePoint * 137) % 360;
  return `hsl(${hue} 68% 42%)`;
}

function setProfileAvatar(avatar, name) {
  const initial = getProfileInitial(name);
  avatar.textContent = initial;
  avatar.style.setProperty("--avatar-color", getAvatarColor(initial));
}

function createProfileAvatar(name, className = "profile-avatar") {
  const avatar = document.createElement("span");
  avatar.className = className;
  avatar.setAttribute("aria-hidden", "true");
  setProfileAvatar(avatar, name);
  return avatar;
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
  const { displayName, username } = contact;
  const entry = document.createElement("button");
  entry.type = "button";
  entry.className = "dm-entry";
  entry.setAttribute("aria-label", isGroup
    ? `Open group chat ${displayName}`
    : `Message ${displayName}, username ${username}, status ${contactStatusLabels[contact.status]}`);
  const avatar = createProfileAvatar(displayName);

  const details = document.createElement("span");
  details.className = "dm-contact-details";

  const label = document.createElement("span");
  label.className = "dm-name-flip";

  const displayNameLabel = document.createElement("span");
  displayNameLabel.className = "dm-display-name";
  displayNameLabel.textContent = displayName;
  label.append(displayNameLabel);

  if (!isGroup) {
    entry.classList.add("has-username");
    const usernameLabel = document.createElement("span");
    usernameLabel.className = "dm-username";
    usernameLabel.textContent = username;
    label.append(usernameLabel);
    details.append(label, createPresenceIndicator(contact.status));
  } else {
    details.append(label);
  }

  entry.append(avatar, details);
  return entry;
}

const placeholderGroupChats = [
  { displayName: "The Band" },
  { displayName: "Weekend Jam" },
  { displayName: "Late Night Crew" },
  { displayName: "After Hours" },
];
const placeholderContacts = [
  { displayName: "Alex Morgan", username: "AlexMorgan", status: "online" },
  { displayName: "Jordan Lee", username: "JordanLee", status: "idle" },
  { displayName: "Morgan Reed", username: "MorganReed", status: "dnd" },
  { displayName: "Casey Parker", username: "CaseyParker", status: "offline" },
  { displayName: "Riley Chen", username: "RileyChen", status: "online" },
  { displayName: "Taylor Brooks", username: "TaylorBrooks", status: "online" },
  { displayName: "Sam Rivera", username: "SamRivera", status: "idle" },
  { displayName: "Jamie Patel", username: "JamiePatel", status: "online" },
  { displayName: "Avery Kim", username: "AveryKim", status: "offline" },
  { displayName: "Quinn Davis", username: "QuinnDavis", status: "online" },
  { displayName: "Cameron Bell", username: "CameronBell", status: "online" },
  { displayName: "Skyler James", username: "SkylerJames", status: "online" },
];

const dmList = document.querySelector("[data-dm-list]");

if (dmList instanceof HTMLElement) {
  const groupHeading = document.createElement("h3");
  groupHeading.className = "dm-subheading";
  groupHeading.textContent = "Group Chats";
  dmList.append(groupHeading);
  placeholderGroupChats.forEach((group) => dmList.append(createDmEntry(group, true)));

  const friendsHeading = document.createElement("h3");
  friendsHeading.className = "dm-subheading";
  friendsHeading.textContent = "Friends";
  dmList.append(friendsHeading);
  placeholderContacts.forEach((contact) => dmList.append(createDmEntry(contact)));
}

document.querySelectorAll(".profile-avatar[data-avatar-name]").forEach((avatar) => {
  if (avatar instanceof HTMLElement) {
    setProfileAvatar(avatar, avatar.dataset.avatarName || "");
  }
});

const micToggle = document.querySelector("[data-mic-toggle]");

if (micToggle instanceof HTMLButtonElement) {
  micToggle.addEventListener("click", () => {
    const isMuted = micToggle.getAttribute("aria-pressed") !== "true";
    micToggle.setAttribute("aria-pressed", String(isMuted));
    micToggle.setAttribute("aria-label", isMuted ? "Unmute microphone" : "Mute microphone");
  });
}
