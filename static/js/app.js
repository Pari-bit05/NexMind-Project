// Shared helpers used by every page: API calls, toasts, Markdown, dates, theme.
(function () {
  "use strict";

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : "";
  }

  // ---------- API ----------

  // options.json sends a JSON body; options.body (FormData) sends a file upload.
  async function api(url, options) {
    options = options || {};
    var method = (options.method || "GET").toUpperCase();
    var init = { method: method, headers: { Accept: "application/json" }, credentials: "same-origin" };

    if (method !== "GET") init.headers["X-CSRF-Token"] = csrfToken();

    if (options.json !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.json);
    } else if (options.body) {
      init.body = options.body;
    }

    var response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new Error("Can't reach the server. Check your connection and try again.");
    }

    if (response.status === 401) {
      window.location.href = "/login";
      throw new Error("Your session ended. Log in again.");
    }

    var data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong. Try again.");
    }

    return data;
  }

  // ---------- Toasts ----------

  function toast(message, type) {
    var host = document.querySelector(".toasts");

    if (!host) {
      host = document.createElement("div");
      host.className = "toasts";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }

    var item = document.createElement("div");
    item.className = "toast" + (type ? " toast-" + type : "");
    item.textContent = message;
    host.appendChild(item);

    setTimeout(function () {
      item.remove();
    }, type === "error" ? 7000 : 4000);
  }

  // ---------- Buttons ----------

  function setBusy(button, busy, busyLabel) {
    if (!button) return;

    if (busy) {
      button.dataset.label = button.innerHTML;
      button.setAttribute("aria-busy", "true");
      button.disabled = true;
      if (busyLabel) {
        button.innerHTML = '<span class="spinner"></span>' + escapeHtml(busyLabel);
      }
    } else {
      button.removeAttribute("aria-busy");
      button.disabled = false;
      if (button.dataset.label !== undefined) {
        button.innerHTML = button.dataset.label;
        delete button.dataset.label;
      }
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        toast("Copied to clipboard.", "success");
      }, function () {
        toast("Couldn't copy. Select the text and copy it by hand.", "error");
      });
    }
    toast("Couldn't copy. Select the text and copy it by hand.", "error");
    return Promise.resolve();
  }

  function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight + 2, 160) + "px";
  }

  // ---------- Text ----------

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Inline Markdown. Input must already be HTML-escaped.
  function inline(text) {
    var codes = [];

    text = text.replace(/`([^`]+)`/g, function (match, code) {
      codes.push(code);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });

    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
    text = text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    return text.replace(/\u0000(\d+)\u0000/g, function (match, index) {
      return "<code>" + codes[Number(index)] + "</code>";
    });
  }

  var LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  var TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function splitRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (cell) {
      return cell.trim();
    });
  }

  function parseList(lines, start) {
    var first = lines[start].match(LIST_ITEM);
    var baseIndent = first[1].length;
    var ordered = /\d/.test(first[2]);
    var items = [];
    var i = start;

    while (i < lines.length) {
      if (!lines[i].trim()) {
        // A single blank line between items keeps the same list going.
        var j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        var upcoming = j < lines.length ? lines[j].match(LIST_ITEM) : null;
        if (upcoming && upcoming[1].length >= baseIndent) {
          i = j;
          continue;
        }
        break;
      }

      var match = lines[i].match(LIST_ITEM);
      if (!match) break;

      var indent = match[1].length;
      if (indent < baseIndent) break;

      if (indent > baseIndent) {
        var sub = parseList(lines, i);
        if (items.length) items[items.length - 1].sub += sub.html;
        else items.push({ text: "", sub: sub.html });
        i = sub.next;
        continue;
      }

      items.push({ text: match[3], sub: "" });
      i++;

      while (
        i < lines.length && lines[i].trim() &&
        !LIST_ITEM.test(lines[i]) && /^\s{2,}\S/.test(lines[i])
      ) {
        items[items.length - 1].text += " " + lines[i].trim();
        i++;
      }
    }

    var tag = ordered ? "ol" : "ul";
    var html = "<" + tag + ">" + items.map(function (item) {
      return "<li>" + inline(escapeHtml(item.text)) + item.sub + "</li>";
    }).join("") + "</" + tag + ">";

    return { html: html, next: i };
  }

  function startsBlock(line, next) {
    return (
      /^\s*```/.test(line) ||
      /^#{1,4}\s+/.test(line) ||
      LIST_ITEM.test(line) ||
      /^\s*>/.test(line) ||
      /^\s*([-*_])\1{2,}\s*$/.test(line) ||
      (line.indexOf("|") !== -1 && next !== undefined && TABLE_SEP.test(next))
    );
  }

  // A small, safe Markdown renderer: everything is escaped before formatting.
  function renderMarkdown(source) {
    var lines = String(source).replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (/^\s*```/.test(line)) {
        var code = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        i++;
        out.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
        continue;
      }

      if (!line.trim()) {
        i++;
        continue;
      }

      var heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        var level = Math.min(heading[1].length + 1, 4);
        out.push("<h" + level + ">" + inline(escapeHtml(heading[2].replace(/#+\s*$/, ""))) + "</h" + level + ">");
        i++;
        continue;
      }

      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        out.push("<hr>");
        i++;
        continue;
      }

      if (line.indexOf("|") !== -1 && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        var head = splitRow(line);
        var rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") !== -1) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push(
          '<div class="table-wrap"><table><thead><tr>' +
          head.map(function (cell) { return "<th>" + inline(escapeHtml(cell)) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          rows.map(function (row) {
            return "<tr>" + row.map(function (cell) {
              return "<td>" + inline(escapeHtml(cell)) + "</td>";
            }).join("") + "</tr>";
          }).join("") +
          "</tbody></table></div>"
        );
        continue;
      }

      if (/^\s*>/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        out.push("<blockquote>" + inline(escapeHtml(quote.join(" "))) + "</blockquote>");
        continue;
      }

      if (LIST_ITEM.test(line)) {
        var list = parseList(lines, i);
        out.push(list.html);
        i = list.next;
        continue;
      }

      var paragraph = [];
      while (i < lines.length && lines[i].trim() && !(paragraph.length && startsBlock(lines[i], lines[i + 1]))) {
        paragraph.push(lines[i].trim());
        i++;
      }
      out.push("<p>" + inline(escapeHtml(paragraph.join("\n"))).replace(/\n/g, "<br>") + "</p>");
    }

    return out.join("");
  }

  // ---------- Dates ----------

  function timeAgo(iso) {
    if (!iso) return "";
    var then = new Date(iso);
    if (isNaN(then)) return "";

    var seconds = Math.round((Date.now() - then.getTime()) / 1000);
    if (seconds < 60) return "just now";

    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " min ago";

    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");

    var days = Math.round(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";

    return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function formatDate(iso, withYear) {
    var date = new Date(iso);
    if (isNaN(date)) return "";
    var options = { day: "numeric", month: "short" };
    if (withYear) options.year = "numeric";
    return date.toLocaleDateString(undefined, options);
  }

  // Turns a "YYYY-MM-DD" due date into a label and a state, using the local calendar day.
  function dueInfo(value) {
    if (!value) return { text: "No due date", kind: "none", days: null };

    var parts = value.split("-").map(Number);
    var due = new Date(parts[0], parts[1] - 1, parts[2]);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((due - today) / 86400000);

    if (days < -1) return { text: "Overdue by " + -days + " days", kind: "overdue", days: days };
    if (days === -1) return { text: "Due yesterday", kind: "overdue", days: days };
    if (days === 0) return { text: "Due today", kind: "today", days: days };
    if (days === 1) return { text: "Due tomorrow", kind: "soon", days: days };
    if (days < 7) {
      return { text: "Due " + due.toLocaleDateString(undefined, { weekday: "long" }), kind: "soon", days: days };
    }
    return {
      text: "Due " + due.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      kind: "later",
      days: days
    };
  }

  // ---------- Page chrome ----------

  function init() {
    // Theme toggle
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      function paint() {
        var dark = document.documentElement.getAttribute("data-theme") === "dark";
        button.setAttribute("aria-pressed", dark ? "true" : "false");
        var label = button.querySelector("[data-theme-label]");
        if (label) label.textContent = dark ? "Light mode" : "Dark mode";
        var use = button.querySelector("use");
        if (use) use.setAttribute("href", dark ? "#i-sun" : "#i-moon");
      }

      paint();

      button.addEventListener("click", function () {
        var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem("nexmind-theme", next);
        } catch (error) {
          /* private mode: the choice just won't persist */
        }
        paint();
      });
    });

    // Mobile sidebar
    var sidebar = document.querySelector(".sidebar");
    var scrim = document.querySelector(".scrim");

    function setMenu(open) {
      if (!sidebar) return;
      sidebar.classList.toggle("open", open);
      if (scrim) scrim.classList.toggle("open", open);
      document.querySelectorAll("[data-menu-open]").forEach(function (button) {
        button.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    document.querySelectorAll("[data-menu-open]").forEach(function (button) {
      button.addEventListener("click", function () {
        setMenu(!sidebar.classList.contains("open"));
      });
    });

    if (scrim) scrim.addEventListener("click", function () { setMenu(false); });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setMenu(false);
    });

    document.querySelectorAll(".nav a").forEach(function (link) {
      link.addEventListener("click", function () { setMenu(false); });
    });

    // Show/hide password
    document.querySelectorAll("[data-toggle-password]").forEach(function (button) {
      button.addEventListener("click", function () {
        var input = document.getElementById(button.getAttribute("data-toggle-password"));
        if (!input) return;
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        button.textContent = show ? "Hide" : "Show";
        button.setAttribute("aria-pressed", show ? "true" : "false");
      });
    });
  }

  window.NexMind = {
    api: api,
    toast: toast,
    setBusy: setBusy,
    copyText: copyText,
    autoGrow: autoGrow,
    escapeHtml: escapeHtml,
    renderMarkdown: renderMarkdown,
    timeAgo: timeAgo,
    formatDate: formatDate,
    dueInfo: dueInfo
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
