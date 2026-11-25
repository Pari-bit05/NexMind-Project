(function () {
  "use strict";

  var N = window.NexMind;

  var ACTIVITY = {
    tutor: { hl: "tutor", label: "Tutor" },
    quiz: { hl: "quiz", label: "Quiz" },
    result: { hl: "quiz", label: "Quiz result" },
    pdf: { hl: "pdf", label: "PDF" },
    flashcards: { hl: "flashcards", label: "Flashcards" },
    planner: { hl: "planner", label: "Planner" }
  };

  function el(id) {
    return document.getElementById(id);
  }

  function greet() {
    var heading = el("greeting");
    var name = heading.getAttribute("data-name") || "there";
    var hour = new Date().getHours();
    var part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    heading.textContent = part + ", " + name;
  }

  function plural(count, word) {
    return count + " " + word + (count === 1 ? "" : "s");
  }

  function render(data) {
    var counts = data.counts;
    var quiz = data.quiz;

    // Stat tiles
    el("stat-avg").textContent = quiz.attempts ? Math.round(quiz.average) + "%" : "–";
    el("stat-avg-note").textContent = quiz.attempts
      ? plural(quiz.attempts, "quiz") + " taken"
      : "Take a quiz to see your score.";

    el("stat-tasks").textContent = counts.completed_tasks + "/" + counts.tasks;
    var pct = counts.tasks ? Math.round((counts.completed_tasks / counts.tasks) * 100) : 0;
    el("tasks-bar").style.width = pct + "%";

    el("stat-cards").textContent = counts.cards_total;
    el("stat-cards-note").textContent = counts.cards_total
      ? "Ready to study."
      : "Generate your first deck.";

    // Tool counts
    el("c-tutor").textContent = counts.tutor;
    el("c-quiz").textContent = counts.quiz;
    el("c-pdf").textContent = counts.pdf;
    el("c-flashcards").textContent = counts.cards_total;
    el("c-planner").textContent = Math.max(counts.tasks - counts.completed_tasks, 0);
    el("c-analytics").textContent = quiz.attempts;

    // Due soon
    var due = el("due-list");

    if (!data.upcoming.length) {
      due.innerHTML = '<li class="muted">Nothing due. <a href="/planner">Add a study task</a> to see it here.</li>';
    } else {
      due.innerHTML = data.upcoming.map(function (task) {
        var info = N.dueInfo(task.due_date);
        var badge = info.kind === "overdue" ? "badge-bad"
          : info.kind === "today" ? "badge-warn"
          : "badge-plain";

        return '<li data-hl="planner"><span class="swatch"></span>' +
          '<div class="title"><strong>' + N.escapeHtml(task.topic) + '</strong>' +
          '<div class="small muted">' + N.escapeHtml(task.subject) + '</div></div>' +
          '<span class="badge ' + badge + ' when" style="margin-left:auto">' + N.escapeHtml(info.text) + '</span></li>';
      }).join("");
    }

    // Recent activity
    var feed = el("activity-list");

    if (!data.recent.length) {
      feed.innerHTML = '<li class="muted">Nothing yet. Ask the tutor a question to get started.</li>';
    } else {
      feed.innerHTML = data.recent.map(function (item) {
        var meta = ACTIVITY[item.activity] || { hl: "home", label: "Activity" };

        return '<li data-hl="' + meta.hl + '"><span class="swatch"></span>' +
          '<span class="title">' + N.escapeHtml(item.title || meta.label) + '</span>' +
          '<span class="when">' + N.escapeHtml(N.timeAgo(item.created_at)) + '</span></li>';
      }).join("");
    }
  }

  greet();

  N.api("/api/dashboard-stats").then(render).catch(function (error) {
    N.toast(error.message, "error");
    el("stat-avg-note").textContent = "Couldn't load your stats.";
    el("stat-cards-note").textContent = "Couldn't load your stats.";
    el("due-list").innerHTML = '<li class="muted">Couldn\'t load tasks. Refresh the page to try again.</li>';
    el("activity-list").innerHTML = '<li class="muted">Couldn\'t load activity. Refresh the page to try again.</li>';
  });
})();
