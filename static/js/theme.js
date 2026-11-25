// Runs in <head> before the page paints, so the saved theme never flashes.
(function () {
  try {
    var saved = localStorage.getItem("nexmind-theme");
    var dark = saved
      ? saved === "dark"
      : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (error) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
