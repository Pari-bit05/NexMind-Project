(function () {
  "use strict";

  var N = window.NexMind;
  var MAX_BYTES = 10 * 1024 * 1024;

  function el(id) {
    return document.getElementById(id);
  }

  var drop = el("drop");
  var input = el("file");
  var summarizeButton = el("summarize");
  var file = null;
  var summary = "";
  var title = "";

  function sizeLabel(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function setFile(chosen) {
    if (!chosen) return;

    if (!/\.pdf$/i.test(chosen.name)) {
      N.toast("Only PDF files are supported.", "error");
      return;
    }

    if (chosen.size > MAX_BYTES) {
      N.toast("That file is " + sizeLabel(chosen.size) + ". The maximum is 10 MB.", "error");
      return;
    }

    file = chosen;
    el("file-name").textContent = chosen.name;
    el("file-size").textContent = sizeLabel(chosen.size);
    el("file-info").hidden = false;
    summarizeButton.disabled = false;
    el("result").hidden = true;
  }

  function clearFile() {
    file = null;
    input.value = "";
    el("file-info").hidden = true;
    summarizeButton.disabled = true;
  }

  input.addEventListener("change", function () { setFile(input.files[0]); });
  el("file-clear").addEventListener("click", clearFile);

  ["dragenter", "dragover"].forEach(function (name) {
    drop.addEventListener(name, function (event) {
      event.preventDefault();
      drop.classList.add("over");
    });
  });

  ["dragleave", "drop"].forEach(function (name) {
    drop.addEventListener(name, function (event) {
      event.preventDefault();
      drop.classList.remove("over");
    });
  });

  drop.addEventListener("drop", function (event) {
    var dropped = event.dataTransfer && event.dataTransfer.files[0];
    setFile(dropped);
  });

  // ---------- Summarize ----------

  summarizeButton.addEventListener("click", async function () {
    if (!file) return;

    var status = el("pdf-status");
    var data = new FormData();
    data.append("file", file);

    N.setBusy(summarizeButton, true, "Reading PDF");
    status.textContent = "Long files can take up to a minute.";

    try {
      var result = await N.api("/api/pdf", { method: "POST", body: data });

      summary = result.summary;
      title = result.filename.replace(/\.pdf$/i, "").slice(0, 120);

      el("result-title").textContent = result.filename;

      var meta = result.pages + (result.pages === 1 ? " page" : " pages");
      if (result.truncated) meta += ". Only the first part of a long document was summarized.";
      el("result-meta").textContent = meta;

      el("summary").innerHTML = N.renderMarkdown(summary);
      el("result").hidden = false;
      el("result").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      N.toast(error.message, "error");
    } finally {
      N.setBusy(summarizeButton, false);
      status.textContent = "";
    }
  });

  // ---------- Actions on the summary ----------

  el("copy").addEventListener("click", function () { N.copyText(summary); });

  el("download").addEventListener("click", function () {
    var blob = new Blob(["# " + title + "\n\n" + summary + "\n"], { type: "text/markdown" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = (title || "summary").replace(/[^\w\- ]+/g, "") + "-summary.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  el("make-cards").addEventListener("click", async function () {
    var button = this;
    N.setBusy(button, true, "Making cards");

    try {
      var data = await N.api("/api/flashcards", {
        method: "POST",
        json: { topic: title || "PDF summary", material: summary, count: 10 }
      });

      N.toast("Saved " + data.flashcards.length + " flashcards. Find them on the Flashcards page.", "success");
    } catch (error) {
      N.toast(error.message, "error");
    } finally {
      N.setBusy(button, false);
    }
  });

  el("make-quiz").addEventListener("click", function () {
    try {
      sessionStorage.setItem("nexmind-material", JSON.stringify({ material: summary, title: title }));
    } catch (error) {
      N.toast("Couldn't pass the summary to the quiz page. Paste it in manually.", "error");
      return;
    }

    window.location.href = "/quiz";
  });
})();
