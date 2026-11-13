const accountSettingsKey = "bandcast.accountSettings";
const defaultProfileAvatarColor = "#5865f2";
const settingsStatus = document.querySelector("[data-settings-status]");

function showSettingsStatus(message, isError = false) {
  if (!(settingsStatus instanceof HTMLElement)) {
    return;
  }

  settingsStatus.textContent = message;
  settingsStatus.hidden = false;
  settingsStatus.classList.toggle("is-error", isError);
}

function readSavedSettings() {
  try {
    const storedSettings = localStorage.getItem(accountSettingsKey);
    if (!storedSettings) {
      return {};
    }

    const parsedSettings = JSON.parse(storedSettings);
    if (!parsedSettings || typeof parsedSettings !== "object" || Array.isArray(parsedSettings)) {
      throw new TypeError("Saved settings must be an object.");
    }
    return parsedSettings;
  } catch (error) {
    console.error("Unable to load saved account settings.", error);
    showSettingsStatus("Could not load saved settings. You can still update and save them.", true);
    return {};
  }
}

function applySavedSettings(form, storedSettings) {
  const sectionSettings = storedSettings[form.dataset.settingsForm];
  if (!sectionSettings || typeof sectionSettings !== "object" || Array.isArray(sectionSettings)) {
    return;
  }

  Array.from(form.elements).forEach((field) => {
    if (!field.name || !Object.prototype.hasOwnProperty.call(sectionSettings, field.name)) {
      return;
    }

    const value = sectionSettings[field.name];
    if (field.type === "checkbox") {
      field.checked = value === true;
    } else if (typeof value === "string") {
      field.value = value;
    }
  });
}

function collectFormSettings(form) {
  const values = {};
  Array.from(form.elements).forEach((field) => {
    if (!field.name) {
      return;
    }
    values[field.name] = field.type === "checkbox" ? field.checked : field.value;
  });
  return values;
}

function initializeProfileAvatarEditor() {
  const form = document.querySelector('[data-settings-form="profile"]');
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const colorInput = form.querySelector("[data-profile-avatar-color]");
  const imageInput = form.querySelector("[data-profile-avatar-image]");
  const fileInput = form.querySelector("[data-profile-avatar-file]");
  const fileName = form.querySelector("[data-profile-avatar-file-name]");
  const preview = form.querySelector("[data-profile-avatar-preview]");
  const swatch = form.querySelector("[data-profile-avatar-swatch]");
  const resetButton = form.querySelector("[data-profile-avatar-reset]");
  const errorMessage = form.querySelector("[data-profile-avatar-error]");
  const displayNameInput = document.querySelector('[data-settings-form="account"] [name="displayName"]');

  if (!(colorInput instanceof HTMLInputElement)
    || !(imageInput instanceof HTMLInputElement)
    || !(fileInput instanceof HTMLInputElement)
    || !(fileName instanceof HTMLElement)
    || !(preview instanceof HTMLElement)
    || !(swatch instanceof HTMLElement)
    || !(resetButton instanceof HTMLButtonElement)
    || !(errorMessage instanceof HTMLElement)) {
    return;
  }

  const updatePreview = () => {
    const imageSource = imageInput.value.startsWith("data:image/") ? imageInput.value : "";
    preview.style.setProperty("--avatar-color", colorInput.value);
    preview.classList.toggle("has-profile-image", Boolean(imageSource));
    preview.replaceChildren();

    if (imageSource) {
      const image = document.createElement("img");
      image.className = "profile-avatar-image";
      image.src = imageSource;
      image.alt = "";
      preview.append(image);
    } else {
      const displayName = displayNameInput instanceof HTMLInputElement ? displayNameInput.value.trim() : "";
      const firstCharacter = Array.from(displayName)[0];
      preview.textContent = firstCharacter ? Array.from(firstCharacter.toUpperCase())[0] || "?" : "?";
    }

    swatch.style.backgroundColor = colorInput.value;
  };

  const showAvatarError = (message) => {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  };

  colorInput.addEventListener("input", updatePreview);
  displayNameInput?.addEventListener("input", updatePreview);
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      showAvatarError("Choose an image file.");
      fileInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string" || !reader.result.startsWith("data:image/")) {
        showAvatarError("Could not read that image. Choose a different file.");
        return;
      }

      imageInput.value = reader.result;
      fileName.textContent = file.name;
      errorMessage.hidden = true;
      updatePreview();
    });
    reader.addEventListener("error", () => {
      showAvatarError("Could not read that image. Choose a different file.");
    });
    reader.readAsDataURL(file);
  });

  resetButton.addEventListener("click", () => {
    colorInput.value = defaultProfileAvatarColor;
    imageInput.value = "";
    fileInput.value = "";
    fileName.textContent = "Using default initials";
    errorMessage.hidden = true;
    updatePreview();
  });

  fileName.textContent = imageInput.value.startsWith("data:image/")
    ? "Custom image saved"
    : "Using default initials";
  updatePreview();
}

function applyAppearanceSettings(appearance) {
  document.documentElement.classList.toggle("compact-interface", appearance.density === "compact");
  document.documentElement.classList.toggle("reduce-motion", appearance.reduceMotion === true);
}

let savedSettings = readSavedSettings();
const settingsForms = document.querySelectorAll("[data-settings-form]");

settingsForms.forEach((form) => {
  if (!(form instanceof HTMLFormElement)) {
    return;
  }
  applySavedSettings(form, savedSettings);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const updatedSettings = {
      ...savedSettings,
      [form.dataset.settingsForm]: collectFormSettings(form),
    };

    try {
      localStorage.setItem(accountSettingsKey, JSON.stringify(updatedSettings));
    } catch (error) {
      console.error("Unable to save account settings.", error);
      showSettingsStatus("Could not save settings in this browser. Check available storage and try again.", true);
      return;
    }

    savedSettings = updatedSettings;
    if (form.dataset.settingsForm === "appearance") {
      applyAppearanceSettings(updatedSettings.appearance);
    }
    showSettingsStatus(`${form.dataset.settingsLabel} saved in this browser.`);
  });
});

initializeProfileAvatarEditor();
applyAppearanceSettings(savedSettings.appearance || {});
