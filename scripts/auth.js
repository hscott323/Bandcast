async function authRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }
  if (!response.ok) {
    throw new Error(result.error || "The request could not be completed.");
  }
  return result;
}

function showAuthError(form, message) {
  let error = form.querySelector("[data-auth-error]");
  if (!(error instanceof HTMLElement)) {
    error = document.createElement("p");
    error.className = "auth-error";
    error.setAttribute("role", "alert");
    error.dataset.authError = "";
    form.append(error);
  }
  error.textContent = message;
}

document.querySelectorAll("[data-auth-form]").forEach((form) => {
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const usernameInput = form.querySelector('[name="username"]');
    const passwordInput = form.querySelector('[name="password"]');
    const submit = form.querySelector('[type="submit"]');
    if (!(usernameInput instanceof HTMLInputElement)
      || !(passwordInput instanceof HTMLInputElement)
      || !(submit instanceof HTMLButtonElement)) {
      showAuthError(form, "Could not read the account form. Please reload and try again.");
      return;
    }

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      showAuthError(form, "Enter your username and password.");
      return;
    }

    const isSignup = form.dataset.authForm === "signup";
    if (isSignup) {
      const confirmationInput = form.querySelector('[name="confirm-password"]');
      if (!(confirmationInput instanceof HTMLInputElement)
        || confirmationInput.value !== password) {
        showAuthError(form, "Your passwords do not match.");
        return;
      }
      if (password.length < 10) {
        showAuthError(form, "Your password must be at least 10 characters.");
        return;
      }
      const termsInput = form.querySelector('[name="terms"]');
      if (!(termsInput instanceof HTMLInputElement) || !termsInput.checked) {
        showAuthError(form, "Accept the Terms of Service to create an account.");
        return;
      }
    }

    submit.disabled = true;
    try {
      await authRequest(`/api/auth/${isSignup ? "signup" : "login"}`, {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          termsAccepted: isSignup,
        }),
      });
      window.location.replace("app.html");
    } catch (error) {
      showAuthError(form, error instanceof Error ? error.message : "Could not sign in.");
      submit.disabled = false;
    }
  });
});

async function logout() {
  await authRequest("/api/auth/logout", { method: "POST" });
  window.location.replace("index.html");
}

function showDeleteAccountConfirmation() {
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
  dialog.setAttribute("aria-labelledby", "delete-account-title");
  dialog.setAttribute("aria-describedby", "delete-account-message");

  const title = document.createElement("h2");
  title.className = "friend-confirmation-title";
  title.id = "delete-account-title";
  title.textContent = "Permanently delete your account?";

  const message = document.createElement("p");
  message.className = "friend-confirmation-message";
  message.id = "delete-account-message";
  message.textContent = "This permanently deletes your account, messages, groups, and uploaded files. This cannot be undone.";

  const error = document.createElement("p");
  error.className = "group-edit-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const actions = document.createElement("div");
  actions.className = "friend-confirmation-actions";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "friend-confirmation-cancel";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => overlay.remove());

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "friend-confirmation-remove";
  deleteButton.textContent = "Delete account";
  deleteButton.addEventListener("click", async () => {
    deleteButton.disabled = true;
    try {
      await authRequest("/api/account", { method: "DELETE" });
      window.location.replace("index.html");
    } catch (deleteError) {
      error.textContent = deleteError instanceof Error ? deleteError.message : "Could not delete the account.";
      error.hidden = false;
      deleteButton.disabled = false;
    }
  });

  actions.append(cancelButton, deleteButton);
  dialog.append(title, message, error, actions);
  overlay.append(dialog);
  document.body.append(overlay);
  cancelButton.focus();
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  if (event.target.closest("[data-logout]")) {
    event.preventDefault();
    logout().catch((error) => {
      console.error("Unable to log out.", error);
      window.alert(error instanceof Error ? error.message : "Could not log out.");
    });
  } else if (event.target.closest("[data-delete-account]")) {
    showDeleteAccountConfirmation();
  }
});

if (document.body.dataset.page === "home") {
  authRequest("/api/auth/me")
    .then(() => window.location.replace("app.html"))
    .catch((error) => {
      if (error.message !== "Sign in to continue.") {
        console.error("Unable to check the current session.", error);
      }
    });
}
