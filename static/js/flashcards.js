(function () {
  "use strict";

  var N = window.NexMind;

  function el(id) {
    return document.getElementById(id);
  }

  var cards = [];
  var editingId = null;

  // ---------- Filtering ----------

  function filtered() {
    var deck = el("deck-filter").value;
    var query = el("search").value.trim().toLowerCase();

    return cards.filter(function (card) {
      if (deck && (card.topic || "").toLowerCase() !== deck.toLowerCase()) return false;
      if (!query) return true;
      return (card.question + " " + card.answer).toLowerCase().indexOf(query) !== -1;
    });
  }

  function renderDecks() {
    var select = el("deck-filter");
    var current = select.value;
    var seen = {};
    var names = [];

    cards.forEach(function (card) {
      var name = card.topic || "My cards";
      if (!seen[name.toLowerCase()]) {
        seen[name.toLowerCase()] = true;
        names.push(name);
      }
    });

    names.sort(function (a, b) { return a.localeCompare(b); });

    select.innerHTML = '<option value="">All decks</option>' + names.map(function (name) {
      return '<option value="' + N.escapeHtml(name) + '">' + N.escapeHtml(name) + "</option>";
    }).join("");

    if (current && seen[current.toLowerCase()]) select.value = current;

    el("deck-list").innerHTML = names.map(function (name) {
      return '<option value="' + N.escapeHtml(name) + '"></option>';
    }).join("");
  }

  // ---------- Grid ----------

  function cardElement(card) {
    var wrap = document.createElement("div");

    var flip = document.createElement("div");
    flip.className = "flip";
    flip.tabIndex = 0;
    flip.setAttribute("role", "button");
    flip.setAttribute("aria-label", "Flip card: " + card.question);

    var inner = document.createElement("div");
    inner.className = "flip-inner";

    var front = document.createElement("div");
    front.className = "face front";
    front.innerHTML = '<span class="side">Question</span>';
    var q = document.createElement("span");
    q.textContent = card.question;
    front.appendChild(q);

    var back = document.createElement("div");
    back.className = "face back";
    back.innerHTML = '<span class="side">Answer</span>';
    var a = document.createElement("span");
    a.textContent = card.answer;
    back.appendChild(a);

    inner.appendChild(front);
    inner.appendChild(back);
    flip.appendChild(inner);

    function toggle() { flip.classList.toggle("flipped"); }
    flip.addEventListener("click", toggle);
    flip.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });

    var tools = document.createElement("div");
    tools.className = "card-tools";

    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = card.topic || "My cards";

    var buttons = document.createElement("div");
    buttons.className = "row";
    buttons.style.gap = "0.1rem";

    var edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-icon btn-ghost btn-sm";
    edit.setAttribute("aria-label", "Edit card");
    edit.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg>';
    edit.addEventListener("click", function () { openEdit(card); });

    var del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-icon btn-ghost btn-sm btn-danger";
    del.setAttribute("aria-label", "Delete card");
    del.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>';
    del.addEventListener("click", function () { remove(card); });

    buttons.appendChild(edit);
    buttons.appendChild(del);
    tools.appendChild(badge);
    tools.appendChild(buttons);

    wrap.appendChild(flip);
    wrap.appendChild(tools);
    return wrap;
  }

  function render() {
    var shown = filtered();
    var deck = el("deck");

    deck.innerHTML = "";
    shown.forEach(function (card) { deck.appendChild(cardElement(card)); });

    el("card-count").textContent = cards.length
      ? "(" + (shown.length === cards.length ? cards.length : shown.length + " of " + cards.length) + ")"
      : "";

    el("study-start").disabled = shown.length === 0;

    var empty = el("deck-empty");
    empty.hidden = shown.length > 0;

    if (!shown.length) {
      if (cards.length) {
        el("deck-empty-title").textContent = "No cards match";
        el("deck-empty-text").textContent = "Try a different deck or search term.";
      } else {
        el("deck-empty-title").textContent = "No flashcards yet";
        el("deck-empty-text").textContent = "Generate a deck above, or add a card by hand.";
      }
    }
  }

  async function load() {
    try {
      var data = await N.api("/api/flashcards");
      cards = data.flashcards;
      renderDecks();
      render();
    } catch (error) {
      N.toast(error.message, "error");
    }
  }

  // ---------- Create ----------

  el("ai-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    var topic = el("ai-topic").value.trim();
    var material = el("ai-material").value.trim();
    var count = parseInt(el("ai-count").value, 10);

    if (!topic && !material) {
      N.toast("Enter a topic or paste some notes first.", "error");
      el("ai-topic").focus();
      return;
    }

    if (!(count >= 1 && count <= 20)) {
      N.toast("Choose between 1 and 20 cards.", "error");
      el("ai-count").focus();
      return;
    }

    var button = el("ai-button");
    N.setBusy(button, true, "Generating");
    el("ai-status").textContent = "This usually takes 10 to 20 seconds.";

    try {
      var data = await N.api("/api/flashcards", {
        method: "POST",
        json: { topic: topic, material: material, count: count }
      });

      cards = data.flashcards.concat(cards);
      renderDecks();
      el("deck-filter").value = data.flashcards[0].topic;
      render();

      N.toast(data.warning || ("Added " + data.flashcards.length + " flashcards."), data.warning ? "" : "success");
      el("deck").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      N.toast(error.message, "error");
    } finally {
      N.setBusy(button, false);
      el("ai-status").textContent = "";
    }
  });

  el("manual-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    var button = this.querySelector('button[type="submit"]');
    N.setBusy(button, true, "Adding");

    try {
      var data = await N.api("/api/flashcards", {
        method: "POST",
        json: {
          question: el("m-question").value,
          answer: el("m-answer").value,
          topic: el("m-topic").value
        }
      });

      cards = data.flashcards.concat(cards);
      renderDecks();
      render();

      el("m-question").value = "";
      el("m-answer").value = "";
      el("m-question").focus();
      N.toast("Card added.", "success");
    } catch (error) {
      N.toast(error.message, "error");
    } finally {
      N.setBusy(button, false);
    }
  });

  // ---------- Edit and delete ----------

  var editDialog = el("edit-dialog");

  function openEdit(card) {
    editingId = card.id;
    el("e-question").value = card.question;
    el("e-answer").value = card.answer;
    el("e-topic").value = card.topic || "";
    editDialog.showModal();
  }

  el("edit-cancel").addEventListener("click", function () { editDialog.close(); });

  el("edit-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    var button = this.querySelector('button[type="submit"]');
    N.setBusy(button, true, "Saving");

    try {
      await N.api("/api/flashcards/" + editingId, {
        method: "PATCH",
        json: {
          question: el("e-question").value,
          answer: el("e-answer").value,
          topic: el("e-topic").value
        }
      });

      editDialog.close();
      N.toast("Card updated.", "success");
      await load();
    } catch (error) {
      N.toast(error.message, "error");
    } finally {
      N.setBusy(button, false);
    }
  });

  async function remove(card) {
    if (!window.confirm("Delete this flashcard?")) return;

    try {
      await N.api("/api/flashcards/" + card.id, { method: "DELETE" });
      cards = cards.filter(function (c) { return c.id !== card.id; });
      renderDecks();
      render();
      N.toast("Card deleted.", "success");
    } catch (error) {
      N.toast(error.message, "error");
    }
  }

  el("deck-filter").addEventListener("change", render);
  el("search").addEventListener("input", render);

  // ---------- Study mode ----------

  var study = { queue: [], index: 0, known: 0, missed: [], flipped: false };
  var studyDialog = el("study-dialog");
  var studyCard = el("study-card");

  function shuffle(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function beginStudy(list) {
    study.queue = shuffle(list);
    study.index = 0;
    study.known = 0;
    study.missed = [];

    el("study-main").hidden = false;
    el("study-done").hidden = true;

    showStudyCard();
  }

  function showStudyCard() {
    var card = study.queue[study.index];

    // Reset without animating, so the next answer is never seen mid-flip.
    studyCard.classList.add("no-anim");
    studyCard.classList.remove("flipped");
    void studyCard.offsetWidth;

    el("study-q").textContent = card.question;
    el("study-a").textContent = card.answer;

    studyCard.classList.remove("no-anim");

    el("study-counter").textContent = "Card " + (study.index + 1) + " of " + study.queue.length;
    el("study-bar").style.width = (study.index / study.queue.length) * 100 + "%";
  }

  function rate(knew) {
    var card = study.queue[study.index];

    if (knew) study.known++;
    else study.missed.push(card);

    study.index++;

    if (study.index >= study.queue.length) {
      finishStudy();
    } else {
      showStudyCard();
    }
  }

  function finishStudy() {
    el("study-main").hidden = true;
    el("study-done").hidden = false;

    var total = study.queue.length;
    el("study-summary").textContent =
      "You knew " + study.known + " of " + total + " cards." +
      (study.missed.length ? " Go through the " + study.missed.length + " you missed again?" : " Nothing missed. Nice work.");

    el("study-again-missed").hidden = study.missed.length === 0;
  }

  el("study-start").addEventListener("click", function () {
    var list = filtered();
    if (!list.length) return;

    beginStudy(list);
    studyDialog.showModal();
    studyCard.focus();
  });

  studyCard.addEventListener("click", function () { studyCard.classList.toggle("flipped"); });
  el("study-know").addEventListener("click", function () { rate(true); });
  el("study-miss").addEventListener("click", function () { rate(false); });
  el("study-close").addEventListener("click", function () { studyDialog.close(); });
  el("study-done-close").addEventListener("click", function () { studyDialog.close(); });
  el("study-again-missed").addEventListener("click", function () { beginStudy(study.missed); });
  el("study-again-all").addEventListener("click", function () { beginStudy(filtered()); });

  studyDialog.addEventListener("keydown", function (event) {
    if (el("study-main").hidden) return;

    if (event.key === " " || event.key === "Enter") {
      if (event.target.tagName === "BUTTON" && event.target !== studyCard) return;
      event.preventDefault();
      studyCard.classList.toggle("flipped");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      rate(true);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      rate(false);
    }
  });

  load();
})();
