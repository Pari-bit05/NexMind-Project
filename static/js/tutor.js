(function () {
  "use strict";

  var N = window.NexMind;
  var STORE = "nexmind-tutor";
  var MODE_STORE = "nexmind-mode";

  var log = document.getElementById("chat-log");
  var empty = document.getElementById("chat-empty");
  var form = document.getElementById("composer");
  var input = document.getElementById("question");
  var modeSelect = document.getElementById("mode");
  var sendButton = document.getElementById("send");

  var history = [];
  var sending = false;

  // ---------- Storage (survives page changes, not new tabs) ----------

  function save() {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(history.slice(-30)));
    } catch (error) { /* storage unavailable */ }
  }

  function load() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORE) || "[]");
      if (Array.isArray(saved)) history = saved;
    } catch (error) {
      history = [];
    }

    try {
      var mode = localStorage.getItem(MODE_STORE);
      if (mode && Array.prototype.some.call(modeSelect.options, function (o) { return o.value === mode; })) {
        modeSelect.value = mode;
      }
    } catch (error) { /* ignore */ }
  }

  // ---------- Rendering ----------

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function hideEmpty() {
    if (empty) empty.hidden = true;
  }

  function addUser(text) {
    hideEmpty();
    var bubble = document.createElement("div");
    bubble.className = "msg-user";
    bubble.textContent = text;
    log.appendChild(bubble);
    scrollDown();
  }

  function addAI(markdown) {
    hideEmpty();

    var wrap = document.createElement("div");
    wrap.className = "msg-ai";

    var body = document.createElement("div");
    body.className = "prose";
    body.innerHTML = N.renderMarkdown(markdown);

    var tools = document.createElement("div");
    tools.className = "msg-tools";

    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn btn-sm btn-ghost";
    copy.textContent = "Copy answer";
    copy.addEventListener("click", function () { N.copyText(markdown); });

    tools.appendChild(copy);
    wrap.appendChild(body);
    wrap.appendChild(tools);
    log.appendChild(wrap);
    scrollDown();
  }

  function addTyping() {
    var wrap = document.createElement("div");
    wrap.className = "msg-ai";
    wrap.innerHTML = '<div class="typing" role="status"><i></i><i></i><i></i><span class="sr-only">The tutor is thinking</span></div>';
    log.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  function addError(message, retry) {
    var box = document.createElement("div");
    box.className = "status status-error";
    box.setAttribute("role", "alert");

    var text = document.createElement("span");
    text.className = "grow";
    text.textContent = message;
    box.appendChild(text);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm";
    button.textContent = "Try again";
    button.addEventListener("click", function () {
      box.remove();
      retry();
    });
    box.appendChild(button);

    log.appendChild(box);
    scrollDown();
  }

  // ---------- Sending ----------

  async function ask(question, showUser) {
    if (sending) return;

    sending = true;
    sendButton.disabled = true;

    if (showUser) addUser(question);

    var typing = addTyping();

    try {
      var data = await N.api("/api/ask", {
        method: "POST",
        json: { question: question, mode: modeSelect.value, history: history.slice(-8) }
      });

      typing.remove();
      addAI(data.answer);

      history.push({ role: "user", content: question });
      history.push({ role: "assistant", content: data.answer });
      save();
    } catch (error) {
      typing.remove();
      addError(error.message, function () { ask(question, false); });
    } finally {
      sending = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  function submit() {
    var question = input.value.trim();
    if (!question || sending) return;

    input.value = "";
    N.autoGrow(input);
    ask(question, true);
  }

  // ---------- Events ----------

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    submit();
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });

  input.addEventListener("input", function () { N.autoGrow(input); });

  modeSelect.addEventListener("change", function () {
    try {
      localStorage.setItem(MODE_STORE, modeSelect.value);
    } catch (error) { /* ignore */ }
  });

  document.querySelectorAll(".suggest button").forEach(function (button) {
    button.addEventListener("click", function () {
      ask(button.getAttribute("data-q"), true);
    });
  });

  document.getElementById("clear").addEventListener("click", function () {
    if (history.length && !window.confirm("Clear this conversation?")) return;

    history = [];
    save();
    log.querySelectorAll(".msg-user, .msg-ai, .status").forEach(function (node) { node.remove(); });
    if (empty) empty.hidden = false;
    input.focus();
  });

  // ---------- Start ----------

  load();

  history.forEach(function (message) {
    if (message.role === "user") addUser(message.content);
    else addAI(message.content);
  });

  var params = new URLSearchParams(window.location.search);
  var preset = (params.get("q") || "").trim();

  if (preset) {
    window.history.replaceState(null, "", window.location.pathname);
    ask(preset, true);
  } else {
    input.focus();
  }
})();
