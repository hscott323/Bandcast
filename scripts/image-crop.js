(() => {
  const supportedImageTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif",
  ]);

  const minimumZoom = 1;
  const maximumZoom = 3;
  const defaultOutputSize = 512;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function openImageCropper(file, options = {}) {
    return new Promise((resolve) => {
      if (!(file instanceof File)) {
        resolve(null);
        return;
      }
      if (!supportedImageTypes.has(file.type.toLowerCase())) {
        resolve(file);
        return;
      }

      const title = options.title || "Adjust your picture";
      const hint = options.hint || "Drag the picture to move it, then use the slider to zoom.";
      const outputSize = options.outputSize || defaultOutputSize;
      const previousFocus = document.activeElement;
      const objectUrl = URL.createObjectURL(file);

      const overlay = element("div", "image-crop-overlay");
      const dialog = element("section", "image-crop-dialog");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "image-crop-title");
      dialog.setAttribute("aria-describedby", "image-crop-hint");

      const heading = element("h2", "image-crop-title", title);
      heading.id = "image-crop-title";
      const description = element("p", "image-crop-hint", hint);
      description.id = "image-crop-hint";

      const viewport = element("div", "image-crop-viewport");
      viewport.tabIndex = 0;
      viewport.setAttribute("role", "group");
      viewport.setAttribute("aria-label", "Picture crop area. Drag to move the picture or use the arrow keys.");

      const image = document.createElement("img");
      image.className = "image-crop-image";
      image.alt = "";
      image.draggable = false;
      viewport.append(image);

      const zoomLabel = element("label", "image-crop-zoom");
      const zoom = document.createElement("input");
      zoom.type = "range";
      zoom.min = String(minimumZoom);
      zoom.max = String(maximumZoom);
      zoom.step = "0.01";
      zoom.value = "1";
      zoom.disabled = true;
      zoom.setAttribute("aria-label", "Zoom");
      zoomLabel.append(element("span", "", "Zoom"), zoom);

      const error = element("p", "image-crop-error");
      error.setAttribute("role", "alert");
      error.hidden = true;

      const actions = element("div", "image-crop-actions");
      const cancelButton = element("button", "image-crop-cancel", "Cancel");
      cancelButton.type = "button";
      const saveButton = element("button", "image-crop-save", "Use picture");
      saveButton.type = "button";
      saveButton.disabled = true;
      actions.append(cancelButton, saveButton);

      dialog.append(heading, description, viewport, zoomLabel, error, actions);
      overlay.append(dialog);
      document.body.append(overlay);

      let naturalWidth = 0;
      let naturalHeight = 0;
      let baseScale = 1;
      let scale = 1;
      let offsetX = 0;
      let offsetY = 0;
      let pointerId = null;
      let dragStartX = 0;
      let dragStartY = 0;
      let dragStartOffsetX = 0;
      let dragStartOffsetY = 0;
      let closed = false;

      function viewportSize() {
        return viewport.clientWidth;
      }

      function clampOffsets() {
        const size = viewportSize();
        offsetX = Math.min(0, Math.max(size - naturalWidth * scale, offsetX));
        offsetY = Math.min(0, Math.max(size - naturalHeight * scale, offsetY));
      }

      function render() {
        if (!naturalWidth) {
          return;
        }
        image.style.width = `${naturalWidth * scale}px`;
        image.style.height = `${naturalHeight * scale}px`;
        image.style.left = `${offsetX}px`;
        image.style.top = `${offsetY}px`;
      }

      function showError(message) {
        error.textContent = message;
        error.hidden = false;
        saveButton.disabled = true;
        zoom.disabled = true;
      }

      function close(result) {
        if (closed) {
          return;
        }
        closed = true;
        document.removeEventListener("keydown", onKeyDown);
        URL.revokeObjectURL(objectUrl);
        overlay.remove();
        if (previousFocus instanceof HTMLElement) {
          previousFocus.focus();
        }
        resolve(result);
      }

      function onKeyDown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          close(null);
          return;
        }
        if (event.target !== viewport) {
          return;
        }
        const step = event.shiftKey ? 24 : 8;
        if (event.key === "ArrowLeft") {
          offsetX -= step;
        } else if (event.key === "ArrowRight") {
          offsetX += step;
        } else if (event.key === "ArrowUp") {
          offsetY -= step;
        } else if (event.key === "ArrowDown") {
          offsetY += step;
        } else {
          return;
        }
        event.preventDefault();
        clampOffsets();
        render();
      }

      function applyZoom(value) {
        if (!naturalWidth) {
          return;
        }
        const size = viewportSize();
        const centerX = (size / 2 - offsetX) / scale;
        const centerY = (size / 2 - offsetY) / scale;
        scale = baseScale * value;
        offsetX = size / 2 - centerX * scale;
        offsetY = size / 2 - centerY * scale;
        clampOffsets();
        render();
      }

      image.addEventListener("load", () => {
        naturalWidth = image.naturalWidth;
        naturalHeight = image.naturalHeight;
        if (!naturalWidth || !naturalHeight) {
          showError("This picture could not be opened. Choose a different image.");
          return;
        }
        const size = viewportSize();
        baseScale = Math.max(size / naturalWidth, size / naturalHeight);
        scale = baseScale;
        offsetX = (size - naturalWidth * scale) / 2;
        offsetY = (size - naturalHeight * scale) / 2;
        clampOffsets();
        render();
        zoom.disabled = false;
        saveButton.disabled = false;
        viewport.focus();
      });

      image.addEventListener("error", () => {
        showError("This picture could not be opened. Choose a different image.");
      });

      zoom.addEventListener("input", () => {
        applyZoom(Number(zoom.value) || minimumZoom);
      });

      viewport.addEventListener("pointerdown", (event) => {
        if (!naturalWidth || pointerId !== null) {
          return;
        }
        pointerId = event.pointerId;
        viewport.setPointerCapture(pointerId);
        viewport.classList.add("is-dragging");
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragStartOffsetX = offsetX;
        dragStartOffsetY = offsetY;
        event.preventDefault();
      });

      viewport.addEventListener("pointermove", (event) => {
        if (event.pointerId !== pointerId) {
          return;
        }
        offsetX = dragStartOffsetX + (event.clientX - dragStartX);
        offsetY = dragStartOffsetY + (event.clientY - dragStartY);
        clampOffsets();
        render();
      });

      function endDrag(event) {
        if (event.pointerId !== pointerId) {
          return;
        }
        pointerId = null;
        viewport.classList.remove("is-dragging");
      }

      viewport.addEventListener("pointerup", endDrag);
      viewport.addEventListener("pointercancel", endDrag);

      viewport.addEventListener("wheel", (event) => {
        if (!naturalWidth) {
          return;
        }
        event.preventDefault();
        const next = Math.min(maximumZoom, Math.max(minimumZoom, Number(zoom.value) - event.deltaY * 0.002));
        zoom.value = String(next);
        applyZoom(next);
      }, { passive: false });

      cancelButton.addEventListener("click", () => close(null));

      saveButton.addEventListener("click", () => {
        if (closed || !naturalWidth) {
          return;
        }
        saveButton.disabled = true;
        const size = viewportSize();
        const canvas = document.createElement("canvas");
        canvas.width = outputSize;
        canvas.height = outputSize;
        const context = canvas.getContext("2d");
        if (!context) {
          showError("This picture could not be processed.");
          return;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        try {
          context.drawImage(
            image,
            -offsetX / scale,
            -offsetY / scale,
            size / scale,
            size / scale,
            0,
            0,
            outputSize,
            outputSize,
          );
          canvas.toBlob((blob) => {
            if (!blob) {
              showError("This picture could not be processed.");
              saveButton.disabled = false;
              return;
            }
            const baseName = file.name
              .replace(/\.[^./\\]+$/, "")
              .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
              .slice(0, 120) || "picture";
            close(new File([blob], `${baseName}-cropped.png`, { type: "image/png" }));
          }, "image/png");
        } catch {
          showError("This picture could not be processed.");
          saveButton.disabled = false;
        }
      });

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
          close(null);
        }
      });

      document.addEventListener("keydown", onKeyDown);

      image.src = objectUrl;
    });
  }

  window.openImageCropper = openImageCropper;
})();
