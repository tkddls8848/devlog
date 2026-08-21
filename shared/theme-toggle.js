(function () {
  var btn = document.getElementById("theme-toggle");
  if (!btn) return;
  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function current() {
    return document.documentElement.getAttribute("data-theme") || systemTheme();
  }
  function sync() {
    btn.setAttribute("aria-pressed", current() === "dark" ? "true" : "false");
  }
  btn.addEventListener("click", function () {
    var next = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
    sync();
  });
  sync();
})();
