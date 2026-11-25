(function () {
  "use strict";

  var N = window.NexMind;

  function el(id) {
    return document.getElementById(id);
  }

  var tasks = [];
  var filter = "all";
  var editingId = null;

  var list = el("task-list");
  var dialog = el("edit-dialog");

  // ---------- Helpers ----------

  function isOverdue(task) {
    return !task.completed && task.due_date && N.dueInfo(task.due_date).kind === "overdue";
  }

  function visible() {
    return tasks.filter(function (task) {
      if (filter === "todo") return !task.completed;
      if (filter === "done") return !!task.completed;
      if (filter === "overdue") return isOverdue(task);
      return true;
    });
  }

  // ---------- Rendering ----------

  function renderSubjects() {
    var seen = {};
    var options = "";

    tasks.forEach(function (task) {
      var key = task.subject.toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        options += '<option value="' + N.escapeHtml(task.subject) + '"></option>';
      }
    });

    el("subject-list").innerHTML = options;
  }

  function renderProgress() {
    var done = tasks.filter(function (task) { return task.completed; }).length;
    var pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

    el("progress-text").textContent = tasks.length
      ? done + " of " + tasks.length + " done"
      : "No tasks yet";
    el("progress-bar").style.width = pct + "%";
  }

  var EMPTY = {
    all: ["No tasks yet", "Add your first task above to start planning."],
    todo: ["Nothing left to do", "Every task is ticked off. Add a new one when you're ready."],
    overdue: ["Nothing overdue", "You're on top of your deadlines."],
    done: ["Nothing finished yet", "Tick a task off and it will show up here."]
  };

  function render() {
    renderProgress();

    document.querySelectorAll(".tabs button").forEach(function (button) {
      var name = button.getAttribute("data-filter");
      var count = tasks.filter(function (task) {
        if (name === "todo") return !task.completed;
        if (name === "done") return !!task.completed;
        if (name === "overdue") return isOverdue(task);
        return true;
      }).length;

      var base = { all: "All", todo: "To do", overdue: "Overdue", done: "Done" }[name];
      button.textContent = base + " (" + count + ")";
      button.setAttribute("aria-pressed", name === filter ? "true" : "false");
    });

    var shown = visible();
    list.innerHTML = "";

    el("task-empty").hidden = shown.length > 0;
    if (!shown.length) {
      el("empty-title").textContent = EMPTY[filter][0];
      el("empty-text").textContent = EMPTY[filter][1];
    }

    shown.forEach(function (task) {
      var li = document.createElement("li");
      li.className = "task" + (task.completed ? " done" : "");

      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!task.completed;
      box.setAttribute("aria-label", "Mark “" + task.topic + "” as " + (task.completed ? "not done" : "done"));
      box.addEventListener("change", function () { toggle(task, box.checked); });

      var body = document.createElement("div");
      var title = document.createElement("div");
      title.className = "task-title";
      title.textContent = task.topic;
      var subject = document.createElement("div");
      subject.className = "task-subject";
      subject.textContent = task.subject;
      body.appendChild(title);
      body.appendChild(subject);

      var due = document.createElement("span");
      due.className = "due badge";

      if (task.completed) {
        due.classList.add("badge-plain");
        due.textContent = task.due_date ? "Due " + N.formatDate(task.due_date + "T00:00:00") : "No due date";
      } else {
        var info = N.dueInfo(task.due_date);
        due.classList.add(info.kind === "overdue" ? "badge-bad" : info.kind === "today" ? "badge-warn" : "badge-plain");
        due.textContent = info.text;
      }

      var actions = document.createElement("div");
      actions.className = "task-actions";

      var edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn btn-icon btn-ghost btn-sm";
      edit.setAttribute("aria-label", "Edit task");
      edit.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg>';
      edit.addEventListener("click", function () { openEdit(task); });

      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-icon btn-ghost btn-sm btn-danger";
      del.setAttribute("aria-label", "Delete task");
      del.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>';
      del.addEventListener("click", function () { remove(task); });

      actions.appendChild(edit);
      actions.appendChild(del);

      li.appendChild(box);
      li.appendChild(body);
      li.appendChild(due);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  // ---------- Data ----------

  async function load() {
    try {
      var data = await N.api("/api/tasks");
      tasks = data.tasks;
      renderSubjects();
      render();
    } catch (error) {
      el("progress-text").textContent = "Couldn't load your tasks.";
      N.toast(error.message, "error");
    }
  }

  async function toggle(task, completed) {
    var before = task.completed;
    task.completed = completed ? 1 : 0;
    render();

    try {
      await N.api("/api/tasks/" + task.id, { method: "PATCH", json: { completed: completed } });
    } catch (error) {
      task.completed = before;
      render();
      N.toast(error.message, "error");
    }
  }

  async function remove(task) {
    if (!window.confirm("Delete “" + task.topic + "”?")) return;

    try {
      await N.api("/api/tasks/" + task.id, { method: "DELETE" });
      tasks = tasks.filter(function (t) { return t.id !== task.id; });
      renderSubjects();
      render();
      N.toast("Task deleted.", "success");
    } catch (error) {
      N.toast(error.message, "error");
    }
  }

  // ---------- Add ----------

  el("task-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    var button = this.querySelector('button[type="submit"]');
    N.setBusy(button, true, "Adding");

    try {
      await N.api("/api/tasks", {
        method: "POST",
        json: { subject: el("subject").value, topic: el("topic").value, due_date: el("due").value }
      });

      el("topic").value = "";
      el("due").value = "";
      el("topic").focus();
      N.toast("Task added.", "success");

      await load();
    } catch (error) {
      N.toast(error.message, "error");
    } finally {
      N.setBusy(button, false);
    }
  });

  // ---------- Edit ----------

  function openEdit(task) {
    editingId = task.id;
    el("edit-subject").value = task.subject;
    el("edit-topic").value = task.topic;
    el("edit-due").value = task.due_date || "";
    dialog.showModal();
    el("edit-topic").focus();
  }

  el("edit-cancel").addEventListener("click", function () { dialog.close(); });

  el("edit-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    var button = this.querySelector('button[type="submit"]');
    N.setBusy(button, true, "Saving");

    try {
      await N.api("/api/tasks/" + editingId, {
        method: "PATCH",
        json: {
          subject: el("edit-subject").value,
          topic: el("edit-topic").value,
          due_date: el("edit-due").value
        }
      });

      dialog.close();
      N.toast("Task updated.", "success");
      await load();
    } catch (error) {
      N.toast(error.message, "error");
    } finally {
      N.setBusy(button, false);
    }
  });

  // ---------- Filters ----------

  document.querySelectorAll(".tabs button").forEach(function (button) {
    button.addEventListener("click", function () {
      filter = button.getAttribute("data-filter");
      render();
    });
  });

  load();
})();
