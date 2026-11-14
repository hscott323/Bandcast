(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mobile") !== "1") {
    return;
  }

  if (window.location.pathname.endsWith("/mobile-preview.html")) {
    return;
  }

  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.delete("mobile");

  const previewUrl = new URL("mobile-preview.html", window.location.href);
  previewUrl.searchParams.set("page", pageUrl.href);
  previewUrl.searchParams.set("mobile", "1");

  window.location.replace(previewUrl.href);
})();
