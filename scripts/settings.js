const settingsStatus = document.querySelector("[data-settings-status]");

async function settingsApi(path, options = {}) {
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
  let result = null;
  try {
    result = await response.json();
  } catch {
    if (response.ok) {
      throw new Error("The server returned an invalid response.");
    }
  }
  if (response.status === 401) {
    window.location.replace("login.html");
    throw new Error("Please sign in again.");
  }
  if (!response.ok) {
    throw new Error(result?.error || "The request could not be completed.");
  }
  return result;
}

function showSettingsStatus(message, isError = false) {
  if (!(settingsStatus instanceof HTMLElement)) {
    return;
  }
  settingsStatus.textContent = message;
  settingsStatus.hidden = false;
  settingsStatus.classList.toggle("is-error", isError);
}

function getSettingsForm(name) {
  return document.querySelector(`[data-settings-form="${name}"]`);
}

function updateAvatarPreview(profile) {
  const preview = document.querySelector("[data-profile-avatar-preview]");
  const colorInput = document.querySelector("[data-profile-avatar-color]");
  const swatch = document.querySelector("[data-profile-avatar-swatch]");
  const fileName = document.querySelector("[data-profile-avatar-file-name]");
  const imageInput = document.querySelector("[data-profile-avatar-image]");
  const displayName = getSettingsForm("account")?.elements.namedItem("displayName")?.value || "";
  if (!(preview instanceof HTMLElement) || !(colorInput instanceof HTMLInputElement)) {
    return;
  }

  const imageUrl = profile?.avatarUrl || "";
  preview.replaceChildren();
  preview.style.setProperty("--avatar-color", colorInput.value);
  preview.textContent = Array.from(displayName.trim())[0]?.toUpperCase() || "?";
  preview.classList.toggle("has-profile-image", Boolean(imageUrl));
  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "profile-avatar-image";
    image.src = imageUrl;
    image.alt = "";
    preview.replaceChildren(image);
  }
  if (swatch instanceof HTMLElement) {
    swatch.style.backgroundColor = colorInput.value;
  }
  if (fileName instanceof HTMLElement) {
    fileName.textContent = imageUrl ? "Custom image saved" : "Using default initials";
  }
  if (imageInput instanceof HTMLInputElement) {
    imageInput.value = imageUrl;
  }
}

async function loadSettings() {
  try {
    const [{ user }, { profile }, { settings }] = await Promise.all([
      settingsApi("/api/auth/me"),
      settingsApi("/api/profile"),
      settingsApi("/api/settings"),
    ]);
    const accountForm = getSettingsForm("account");
    const profileForm = getSettingsForm("profile");
    if (accountForm instanceof HTMLFormElement) {
      accountForm.elements.namedItem("displayName").value = profile.displayName;
      accountForm.elements.namedItem("username").value = profile.username;
    }
    if (profileForm instanceof HTMLFormElement) {
      profileForm.elements.namedItem("aboutMe").value = profile.bio;
      profileForm.elements.namedItem("avatarColor").value = profile.avatarColor;
    }
    for (const [section, values] of Object.entries({
      privacy: {
        showOnlineStatus: settings.showOnlineStatus,
        discoverable: settings.discoverable,
      },
      appearance: { reduceMotion: settings.reduceMotion },
    })) {
      const form = getSettingsForm(section);
      if (form instanceof HTMLFormElement) {
        Object.entries(values).forEach(([name, value]) => {
          const field = form.elements.namedItem(name);
          if (field instanceof HTMLInputElement) {
            field.checked = value;
          }
        });
      }
    }
    document.querySelector(".profile-name")?.replaceChildren(document.createTextNode(user.displayName));
    updateAvatarPreview(profile);
    applyAppearance(settings.reduceMotion);
    bindSettingsForms(profile);
  } catch (error) {
    if (error instanceof Error && error.message !== "Please sign in again.") {
      showSettingsStatus(error.message, true);
    }
  }
}

function collectSettings() {
  const getChecked = (section, name) => {
    const field = getSettingsForm(section)?.elements.namedItem(name);
    return field instanceof HTMLInputElement && field.checked;
  };
  return {
    showOnlineStatus: getChecked("privacy", "showOnlineStatus"),
    discoverable: getChecked("privacy", "discoverable"),
    reduceMotion: getChecked("appearance", "reduceMotion"),
  };
}

function applyAppearance(reduceMotion) {
  document.documentElement.classList.toggle("reduce-motion", reduceMotion);
}

function bindSettingsForms(profile) {
  const accountForm = getSettingsForm("account");
  accountForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const displayName = accountForm.elements.namedItem("displayName").value.trim();
    try {
      await settingsApi("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName,
          bio: profile.bio,
          avatarColor: profile.avatarColor,
        }),
      });
      profile.displayName = displayName;
      showSettingsStatus("Account settings saved.");
    } catch (error) {
      showSettingsStatus(error.message, true);
    }
  });

  const profileForm = getSettingsForm("profile");
  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const displayName = accountForm.elements.namedItem("displayName").value.trim();
    const bio = profileForm.elements.namedItem("aboutMe").value;
    const avatarColor = profileForm.elements.namedItem("avatarColor").value;
    try {
      const result = await settingsApi("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName, bio, avatarColor }),
      });
      Object.assign(profile, result.profile);
      updateAvatarPreview(profile);
      showSettingsStatus("Profile saved.");
    } catch (error) {
      showSettingsStatus(error.message, true);
    }
  });

  const settingsSections = ["privacy", "appearance"];
  settingsSections.forEach((section) => {
    const form = getSettingsForm(section);
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const settings = collectSettings();
      try {
        await settingsApi("/api/settings", {
          method: "PATCH",
          body: JSON.stringify(settings),
        });
        applyAppearance(settings.reduceMotion);
        showSettingsStatus(`${form.dataset.settingsLabel} saved.`);
      } catch (error) {
        showSettingsStatus(error.message, true);
      }
    });
  });

  const colorInput = profileForm?.elements.namedItem("avatarColor");
  const fileInput = document.querySelector("[data-profile-avatar-file]");
  colorInput?.addEventListener("input", () => updateAvatarPreview(profile));
  accountForm?.elements.namedItem("displayName")?.addEventListener("input", () => updateAvatarPreview(profile));
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    try {
      const result = await settingsApi("/api/profile/avatar", { method: "POST", body: formData });
      profile.avatarUrl = result.file.url;
      updateAvatarPreview(profile);
      showSettingsStatus("Profile picture updated.");
    } catch (error) {
      showSettingsStatus(error.message, true);
    } finally {
      fileInput.value = "";
    }
  });

  document.querySelector("[data-profile-avatar-reset]")?.addEventListener("click", async () => {
    try {
      await settingsApi("/api/profile/avatar", { method: "DELETE" });
      profile.avatarUrl = null;
      updateAvatarPreview(profile);
      showSettingsStatus("Profile picture restored to initials.");
    } catch (error) {
      showSettingsStatus(error.message, true);
    }
  });
}

loadSettings();
