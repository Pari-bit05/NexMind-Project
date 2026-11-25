(function () {
  "use strict";

  var N = window.NexMind;

  function el(id) {
    return document.getElementById(id);
  }

  function submitButton(form) {
    return form.querySelector('button[type="submit"]');
  }

  // Member since
  var since = el("member-since");
  if (since && since.getAttribute("data-iso")) {
    since.textContent = N.formatDate(since.getAttribute("data-iso"), true);
  }

  // Change name
  el("name-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var button = submitButton(this);
    N.setBusy(button, true, "Saving");

    try {
      var data = await N.api("/api/profile", {
        method: "PATCH",
        json: { username: el("username").value }
      });

      var name = document.querySelector(".me-name");
      if (name) name.textContent = data.username;
      var avatar = document.querySelector(".avatar");
      if (avatar) avatar.textContent = data.username.charAt(0);

      N.toast(data.message, "success");
    } catch (error) {
      N.toast(error.message, "error");
    } finally {
      N.setBusy(button, false);
    }
  });

  // Change password
  el("password-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    if (el("new_password").value !== el("confirm_password").value) {
      N.toast("The two new passwords don't match.", "error");
      return;
    }

    var form = this;
    var button = submitButton(form);
    N.setBusy(button, true, "Changing");

    try {
      var data = await N.api("/api/profile/password", {
        method: "POST",
        json: {
          current_password: el("current_password").value,
          new_password: el("new_password").value
        }
      });

      form.reset();
      N.toast(data.message, "success");
    } catch (error) {
      N.toast(error.message, "error");
    } finally {
      N.setBusy(button, false);
    }
  });

  // Delete account
  el("delete-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    if (!window.confirm("Delete your account and all of your study data? This can't be undone.")) {
      return;
    }

    var button = submitButton(this);
    N.setBusy(button, true, "Deleting");

    try {
      var data = await N.api("/api/profile", {
        method: "DELETE",
        json: { password: el("delete_password").value }
      });

      window.location.href = data.redirect || "/register";
    } catch (error) {
      N.toast(error.message, "error");
      N.setBusy(button, false);
    }
  });
})();
