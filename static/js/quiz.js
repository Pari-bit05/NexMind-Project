(function () {
  "use strict";

  var N = window.NexMind;

  function el(id) {
    return document.getElementById(id);
  }

  var views = { setup: el("view-setup"), quiz: el("view-quiz"), result: el("view-result") };

  var state = {
    params: null,
    label: "",
    questions: [],
    index: 0,
    score: 0,
    answers: [],
    answered: false
  };

  function show(name) {
    Object.keys(views).forEach(function (key) {
      views[key].hidden = key !== name;
    });
    window.scrollTo({ top: 0 });
  }

  // A link from Analytics can pre-fill the topic (/quiz?topic=...).
  var presetTopic = new URLSearchParams(window.location.search).get("topic");
  if (presetTopic) el("topic").value = presetTopic.slice(0, 120);

  // ---------- Notes handed over from the PDF page ----------

  try {
    var handoff = JSON.parse(sessionStorage.getItem("nexmind-material") || "null");

    if (handoff && handoff.material) {
      el("material").value = handoff.material.slice(0, 15000);
      el("notes-box").open = true;
      if (handoff.title && !el("topic").value) el("topic").value = handoff.title;
      sessionStorage.removeItem("nexmind-material");
      N.toast("Your PDF summary is loaded as notes. Start the quiz when you're ready.", "success");
    }
  } catch (error) { /* ignore */ }

  // ---------- Start ----------

  async function start(params) {
    var button = el("start");
    var status = el("setup-status");

    N.setBusy(button, true, "Writing questions");
    status.textContent = "This usually takes 10 to 20 seconds.";

    try {
      var data = await N.api("/api/quiz", { method: "POST", json: params });

      state.params = params;
      state.label = params.topic || "Your notes";
      state.questions = data.questions;
      state.index = 0;
      state.score = 0;
      state.answers = [];

      if (data.warning) N.toast(data.warning);

      show("quiz");
      renderQuestion();
    } catch (error) {
      show("setup");
      N.toast(error.message, "error");
    } finally {
      N.setBusy(button, false);
      status.textContent = "";
    }
  }

  el("setup-form").addEventListener("submit", function (event) {
    event.preventDefault();

    var topic = el("topic").value.trim();
    var material = el("material").value.trim();
    var count = parseInt(el("count").value, 10);

    if (!topic && !material) {
      N.toast("Enter a topic or paste some notes first.", "error");
      el("topic").focus();
      return;
    }

    if (!(count >= 1 && count <= 30)) {
      N.toast("Choose between 1 and 30 questions.", "error");
      el("count").focus();
      return;
    }

    start({
      topic: topic,
      difficulty: el("difficulty").value,
      count: count,
      material: material
    });
  });

  // ---------- Questions ----------

  function renderQuestion() {
    var q = state.questions[state.index];
    var total = state.questions.length;

    state.answered = false;

    el("q-counter").textContent = "Question " + (state.index + 1) + " of " + total;
    el("q-bar").style.width = (state.index / total) * 100 + "%";
    el("q-score").textContent = state.score + " correct";
    el("q-text").textContent = q.question;

    var box = el("q-options");
    box.innerHTML = "";

    q.options.forEach(function (text, i) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "opt";
      button.setAttribute("data-i", String(i));

      var key = document.createElement("span");
      key.className = "key";
      key.textContent = String(i + 1);

      var label = document.createElement("span");
      label.textContent = text;

      button.appendChild(key);
      button.appendChild(label);
      button.addEventListener("click", function () { choose(i); });
      box.appendChild(button);
    });

    el("q-explain").hidden = true;
    el("q-next").hidden = true;
    el("q-next").textContent = state.index === total - 1 ? "See results" : "Next question";
  }

  function choose(i) {
    if (state.answered) return;
    state.answered = true;

    var q = state.questions[state.index];
    var correct = i === q.answer;

    if (correct) state.score++;
    state.answers.push({ chosen: i, correct: correct });

    document.querySelectorAll("#q-options .opt").forEach(function (button, n) {
      button.disabled = true;
      if (n === q.answer) button.classList.add("correct");
      else if (n === i) button.classList.add("wrong");
      else button.classList.add("dim");
    });

    var explain = el("q-explain");
    explain.innerHTML = "";

    var lead = document.createElement("strong");
    lead.textContent = correct ? "Correct. " : "Not quite. The answer is " + q.options[q.answer] + ". ";
    explain.appendChild(lead);

    if (q.explanation) explain.appendChild(document.createTextNode(q.explanation));
    explain.hidden = false;

    el("q-score").textContent = state.score + " correct";
    el("q-next").hidden = false;
    el("q-next").focus();
  }

  function next() {
    if (!state.answered) return;

    if (state.index < state.questions.length - 1) {
      state.index++;
      renderQuestion();
    } else {
      finish();
    }
  }

  el("q-next").addEventListener("click", next);

  document.addEventListener("keydown", function (event) {
    if (views.quiz.hidden || event.metaKey || event.ctrlKey || event.altKey) return;

    var tag = (event.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    if (!state.answered && /^[1-4]$/.test(event.key)) {
      var n = Number(event.key) - 1;
      if (n < state.questions[state.index].options.length) choose(n);
    } else if (state.answered && event.key === "Enter" && event.target !== el("q-next")) {
      event.preventDefault();
      next();
    }
  });

  // ---------- Results ----------

  function message(percent) {
    if (percent >= 90) return "Excellent work. You know this topic well.";
    if (percent >= 70) return "Solid result. Look over the questions you missed below.";
    if (percent >= 50) return "You're getting there. Review the missed questions, then retake the quiz.";
    return "This topic needs more work. Try the AI tutor or flashcards, then retake the quiz.";
  }

  async function finish() {
    var total = state.questions.length;
    var percent = Math.round((state.score / total) * 100);
    var missed = [];

    el("q-bar").style.width = "100%";
    el("r-percent").textContent = percent + "%";
    el("r-line").textContent = state.score + " of " + total + " correct on " + state.label;
    el("r-message").textContent = message(percent);

    var review = el("review");
    review.innerHTML = "";

    state.questions.forEach(function (q, n) {
      var answer = state.answers[n];
      if (!answer.correct) missed.push(q);

      var item = document.createElement("div");
      item.className = "review-item " + (answer.correct ? "right" : "missed");

      var title = document.createElement("div");
      title.className = "read";
      title.textContent = (n + 1) + ". " + q.question;
      item.appendChild(title);

      var line = document.createElement("div");
      line.className = "small";
      line.style.marginTop = "0.4rem";

      if (answer.correct) {
        line.textContent = "Your answer: " + q.options[answer.chosen];
      } else {
        line.textContent = "Your answer: " + q.options[answer.chosen] + ". Correct answer: " + q.options[q.answer] + ".";
      }
      item.appendChild(line);

      if (q.explanation) {
        var why = document.createElement("div");
        why.className = "small muted";
        why.style.marginTop = "0.25rem";
        why.textContent = q.explanation;
        item.appendChild(why);
      }

      review.appendChild(item);
    });

    var cardsButton = el("r-cards");
    cardsButton.hidden = !missed.length;
    cardsButton.disabled = false;
    cardsButton.textContent = "Save " + missed.length + " missed as flashcards";
    cardsButton.onclick = function () { saveMissed(missed, cardsButton); };

    show("result");

    try {
      await N.api("/api/quiz-result", {
        method: "POST",
        json: { topic: state.label, score: state.score, total: total }
      });
    } catch (error) {
      N.toast("Your score wasn't saved to analytics. " + error.message, "error");
    }
  }

  async function saveMissed(missed, button) {
    N.setBusy(button, true, "Saving");

    try {
      var cards = missed.map(function (q) {
        var answer = q.options[q.answer];
        if (q.explanation) answer += ". " + q.explanation;
        return { question: q.question, answer: answer, topic: state.label };
      });

      var data = await N.api("/api/flashcards", {
        method: "POST",
        json: { cards: cards, topic: state.label }
      });

      N.setBusy(button, false);
      button.textContent = "Saved " + data.flashcards.length + " flashcards";
      button.disabled = true;
      N.toast("Saved to your flashcards.", "success");
    } catch (error) {
      N.setBusy(button, false);
      N.toast(error.message, "error");
    }
  }

  el("r-retry").addEventListener("click", function () {
    show("setup");
    start(state.params);
  });

  el("r-new").addEventListener("click", function () {
    show("setup");
    el("topic").focus();
  });
})();
