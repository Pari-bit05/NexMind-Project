(function () {
  "use strict";

  var N = window.NexMind;
  var PASS = 70;

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return N.escapeHtml(value);
  }

  function shorten(text, max) {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  function badgeFor(percent) {
    if (percent >= PASS) return "badge-ok";
    if (percent >= 50) return "badge-warn";
    return "badge-bad";
  }

  // ---------- Line chart: score over time ----------

  function trendChart(history) {
    // The API returns newest first. Plot the last 20 attempts, oldest on the left.
    var points = history.slice(0, 20).reverse();

    var W = 640, H = 260;
    var m = { l: 38, r: 14, t: 14, b: 30 };
    var innerW = W - m.l - m.r;
    var innerH = H - m.t - m.b;

    function x(i) {
      return points.length === 1 ? m.l + innerW / 2 : m.l + (innerW * i) / (points.length - 1);
    }

    function y(value) {
      return m.t + innerH - (innerH * value) / 100;
    }

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Line chart of quiz scores over time">';

    [0, 25, 50, 75, 100].forEach(function (tick) {
      svg += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(tick) + '" y2="' + y(tick) + '"/>';
      svg += '<text class="axis-label" x="' + (m.l - 8) + '" y="' + (y(tick) + 4) + '" text-anchor="end">' + tick + "%</text>";
    });

    svg += '<line class="target" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(PASS) + '" y2="' + y(PASS) + '"/>';

    var coords = points.map(function (p, i) {
      return [x(i), y(p.percentage)];
    });

    if (coords.length > 1) {
      var line = coords.map(function (c, i) { return (i ? "L" : "M") + c[0].toFixed(1) + " " + c[1].toFixed(1); }).join(" ");
      svg += '<path class="area" d="' + line + " L" + coords[coords.length - 1][0].toFixed(1) + " " + y(0) + " L" + coords[0][0].toFixed(1) + " " + y(0) + ' Z"/>';
      svg += '<path class="line" d="' + line + '"/>';
    }

    points.forEach(function (p, i) {
      var label = p.topic + ": " + Math.round(p.percentage) + "% (" + p.score + " of " + p.total + "), " + N.formatDate(p.created_at, true);
      svg += '<circle class="dot" cx="' + coords[i][0].toFixed(1) + '" cy="' + coords[i][1].toFixed(1) + '" r="4.5"><title>' + esc(label) + "</title></circle>";
    });

    // Date labels at the ends and the middle
    var labelAt = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map(function (p, i) { return i; });

    labelAt.forEach(function (i) {
      var anchor = i === 0 && points.length > 1 ? "start" : i === points.length - 1 && points.length > 1 ? "end" : "middle";
      svg += '<text class="axis-label" x="' + coords[i][0].toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' + esc(N.formatDate(points[i].created_at)) + "</text>";
    });

    svg += "</svg>";

    el("chart-trend").innerHTML = svg;
    el("trend-note").textContent = points.length === 1
      ? "Take more quizzes to see a trend."
      : "Last " + points.length + " quizzes";
  }

  // ---------- Bar chart: average by topic ----------

  function topicChart(topics) {
    var rows = topics.slice(0, 10);
    var rowH = 38;
    var W = 520;
    var labelW = 150;
    var valueW = 46;
    var barMax = W - labelW - valueW;
    var H = rows.length * rowH + 10;

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Bar chart of average score for each topic">';

    svg += '<line class="target" x1="' + (labelW + (barMax * PASS) / 100) + '" x2="' + (labelW + (barMax * PASS) / 100) + '" y1="0" y2="' + (H - 6) + '"/>';

    rows.forEach(function (row, i) {
      var top = i * rowH + 6;
      var width = Math.max((barMax * row.average) / 100, 3);
      var klass = row.average >= PASS ? "bar-fill" : "bar-weak";
      var label = row.topic + ": " + Math.round(row.average) + "% average over " + row.attempts + (row.attempts === 1 ? " quiz" : " quizzes");

      svg += '<g><title>' + esc(label) + "</title>";
      svg += '<text class="bar-label" x="0" y="' + (top + 19) + '">' + esc(shorten(row.topic, 21)) + "</text>";
      svg += '<rect class="' + klass + '" x="' + labelW + '" y="' + top + '" width="' + width.toFixed(1) + '" height="26" rx="5"/>';
      svg += '<text class="bar-label" x="' + (labelW + width + 8).toFixed(1) + '" y="' + (top + 19) + '">' + Math.round(row.average) + "%</text></g>";
    });

    svg += "</svg>";
    el("chart-topics").innerHTML = svg;
  }

  // ---------- Weak topics ----------

  function weakList(topics) {
    var weak = topics.filter(function (t) { return t.average < PASS; });
    var list = el("weak-list");

    if (!weak.length) {
      list.innerHTML = '<li class="muted">Every topic is at ' + PASS + '% or higher. Try a harder quiz to keep improving.</li>';
      return;
    }

    list.innerHTML = weak.slice(0, 6).map(function (t) {
      var help = "/tutor?q=" + encodeURIComponent("Help me understand " + t.topic);
      var quiz = "/quiz?topic=" + encodeURIComponent(t.topic);

      return '<li data-hl="analytics"><span class="swatch"></span>' +
        '<div class="title"><strong>' + esc(t.topic) + "</strong>" +
        '<div class="small muted">' + t.attempts + (t.attempts === 1 ? " quiz" : " quizzes") + ", average " + Math.round(t.average) + "%</div></div>" +
        '<span class="row when" style="gap:0.35rem"><a class="btn btn-sm" href="' + esc(help) + '">Ask tutor</a>' +
        '<a class="btn btn-sm" href="' + esc(quiz) + '">Retake</a></span></li>';
    }).join("");
  }

  // ---------- History table ----------

  function historyTable(history) {
    el("history").innerHTML = history.slice(0, 20).map(function (row) {
      var percent = Math.round(row.percentage);

      return "<tr><td>" + esc(row.topic) + '</td><td class="num">' + row.score + " / " + row.total +
        '</td><td><span class="badge ' + badgeFor(percent) + '">' + percent + '%</span></td><td class="muted">' +
        esc(N.timeAgo(row.created_at)) + "</td></tr>";
    }).join("");
  }

  // ---------- Load ----------

  N.api("/api/analytics").then(function (data) {
    if (!data.attempts) {
      el("no-data").hidden = false;
      return;
    }

    el("a-attempts").textContent = data.attempts;
    el("a-average").textContent = Math.round(data.average) + "%";
    el("a-best").textContent = Math.round(data.best) + "%";
    el("a-correct").textContent = data.correct + "/" + data.answered;

    trendChart(data.history);
    topicChart(data.topics.slice().sort(function (a, b) { return a.average - b.average; }));
    weakList(data.topics);
    historyTable(data.history);

    el("data").hidden = false;
  }).catch(function (error) {
    el("a-error").hidden = false;
    N.toast(error.message, "error");
  });
})();
