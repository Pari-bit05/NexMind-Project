"""NexMind: an AI study platform built with Flask.

Features: AI tutor, quiz generator, PDF summarizer, flashcards,
study planner, performance analytics and a user profile.
"""

import json
import os
import random
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from functools import wraps
from urllib.parse import urljoin, urlparse

import pymupdf
from dotenv import load_dotenv
from flask import (
    Flask, flash, jsonify, redirect, render_template,
    request, session, url_for
)
from flask_login import (
    LoginManager, UserMixin, current_user,
    login_required, login_user, logout_user
)
from groq import Groq
from werkzeug.security import check_password_hash, generate_password_hash


# =====================================================
# 1. CONFIGURATION
# =====================================================

load_dotenv()

app = Flask(__name__)

_secret = os.getenv("SECRET_KEY", "").strip()
SECRET_KEY_WARNING = None

if not _secret:
    _secret = secrets.token_hex(32)
    SECRET_KEY_WARNING = (
        "SECRET_KEY is not set. Sessions reset every time the server restarts."
    )
elif "changethis" in _secret.lower().replace("_", ""):
    SECRET_KEY_WARNING = (
        "SECRET_KEY still looks like a placeholder. Generate a real one with: "
        "python -c \"import secrets; print(secrets.token_hex(32))\""
    )

app.secret_key = _secret

DATABASE = os.getenv("DATABASE_PATH") or os.path.join(app.root_path, "nexmind.db")
API_KEY = os.getenv("GROQ_API_KEY") or os.getenv("API_KEY")
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")

client = Groq(api_key=API_KEY, timeout=60.0, max_retries=2) if API_KEY else None

app.config.update(
    MAX_CONTENT_LENGTH=10 * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "0") == "1",
    REMEMBER_COOKIE_HTTPONLY=True,
    REMEMBER_COOKIE_SAMESITE="Lax",
    REMEMBER_COOKIE_DURATION=timedelta(days=30),
)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"
login_manager.login_message = "Log in to continue."
login_manager.login_message_category = "error"

AI_LIMIT = 40          # AI requests allowed per user...
AI_WINDOW = 10 * 60    # ...in this many seconds
LOGIN_LIMIT = 8        # failed logins allowed per IP...
LOGIN_WINDOW = 15 * 60 # ...in this many seconds

MAX_PDF_CHARS = 20000
MAX_MATERIAL_CHARS = 15000

DEFAULT_SYSTEM = (
    "You are NexMind, an accurate and helpful academic learning assistant "
    "for students."
)

TUTOR_MODES = {
    "Explain": "Explain clearly and accurately, with examples where useful.",
    "Simple": "Explain in very simple language with an everyday analogy, as if to a beginner.",
    "Step-by-step": "Break the answer into numbered steps and show the reasoning for each step.",
    "Exam-ready": "Answer the way a strong exam answer would: precise definitions, key points, and a short summary.",
    "Quick": "Give a short, direct answer in a few sentences.",
}


# =====================================================
# 2. SMALL HELPERS
# =====================================================

class ApiError(Exception):
    """An error whose message is safe to show to the user."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def api(view):
    """Turn ApiError and unexpected exceptions into JSON responses."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except ApiError as error:
            return jsonify({"error": error.message}), error.status
        except Exception:
            app.logger.exception("Unhandled error in %s", view.__name__)
            return jsonify({
                "error": "Something went wrong on the server. Try again."
            }), 500

    return wrapper


class RateLimiter:
    """Tiny in-memory sliding-window limiter (resets on restart)."""

    def __init__(self):
        self.hits = defaultdict(deque)

    def _prune(self, key, window):
        queue = self.hits[key]
        cutoff = time.time() - window
        while queue and queue[0] < cutoff:
            queue.popleft()
        if not queue:
            self.hits.pop(key, None)

    def blocked(self, key, limit, window):
        self._prune(key, window)
        return len(self.hits.get(key, ())) >= limit

    def hit(self, key, window):
        self._prune(key, window)
        self.hits[key].append(time.time())


limiter = RateLimiter()


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def clean(value, limit):
    if value is None:
        return ""
    return str(value).strip()[:limit]


def int_field(value, label):
    if isinstance(value, bool):
        raise ApiError(f"Invalid {label}.")
    try:
        return int(value)
    except (ValueError, TypeError):
        raise ApiError(f"Invalid {label}.")


def valid_date(value):
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def iso_utc(value):
    """SQLite CURRENT_TIMESTAMP is UTC without a zone marker. Add one."""
    if not value:
        return None
    return str(value).replace(" ", "T") + "Z"


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_safe_next(target):
    if not target or not target.startswith("/") or target.startswith("//"):
        return False
    host = urlparse(request.host_url)
    test = urlparse(urljoin(request.host_url, target))
    return test.scheme in ("http", "https") and host.netloc == test.netloc


# =====================================================
# 3. SECURITY: CSRF, HEADERS, UNAUTHORIZED HANDLING
# =====================================================

def get_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_hex(16)
        session["csrf_token"] = token
    return token


app.jinja_env.globals["csrf_token"] = get_csrf_token


@app.before_request
def csrf_protect():
    if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
        return None

    sent = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")

    if expected and sent and secrets.compare_digest(sent, expected):
        return None

    if request.path.startswith("/api/"):
        return jsonify({
            "error": "Your session expired. Refresh the page and try again."
        }), 400

    flash("Your session expired. Try again.", "error")
    return redirect(url_for("home" if current_user.is_authenticated else "login"))


@app.after_request
def security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )
    return response


@login_manager.unauthorized_handler
def unauthorized():
    if request.path.startswith("/api/"):
        return jsonify({"error": "Your session ended. Log in again."}), 401

    flash("Log in to continue.", "error")
    return redirect(url_for("login", next=request.path))


# =====================================================
# 4. DATABASE
# =====================================================

def get_db():
    db = sqlite3.connect(DATABASE, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    db = get_db()

    try:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                email TEXT UNIQUE,
                password TEXT
            );

            CREATE TABLE IF NOT EXISTS activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                activity_type TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS study_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subject TEXT NOT NULL,
                topic TEXT NOT NULL,
                due_date TEXT,
                completed INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS flashcards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                topic TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS quiz_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                topic TEXT NOT NULL,
                score INTEGER NOT NULL,
                total INTEGER NOT NULL,
                percentage REAL NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_user ON study_tasks(user_id);
            CREATE INDEX IF NOT EXISTS idx_flashcards_user ON flashcards(user_id);
            CREATE INDEX IF NOT EXISTS idx_quiz_results_user ON quiz_results(user_id);
        """)

        # Older databases do not have users.created_at yet.
        columns = {row["name"] for row in db.execute("PRAGMA table_info(users)")}

        if "created_at" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN created_at TEXT")

        db.commit()

    finally:
        db.close()


init_db()


# =====================================================
# 5. USER MODEL
# =====================================================

class User(UserMixin):

    def __init__(self, user_id, username, email):
        self.id = str(user_id)
        self.username = username
        self.email = email


@login_manager.user_loader
def load_user(user_id):

    db = get_db()

    try:
        user = db.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()

        if not user:
            return None

        return User(
            user["id"],
            user["username"] or "Student",
            user["email"] or ""
        )

    finally:
        db.close()


# =====================================================
# 6. ACTIVITY TRACKER
# =====================================================

def save_activity(activity_type, description):

    if not current_user.is_authenticated:
        return

    db = get_db()

    try:
        db.execute("""
            INSERT INTO activities
            (user_id, activity_type, description)
            VALUES (?, ?, ?)
        """, (current_user.id, activity_type, description[:200]))

        db.commit()

    finally:
        db.close()


# =====================================================
# 7. AI CONNECTION
# =====================================================

def map_ai_error(error):
    """Convert an SDK exception into a message a student can act on."""

    name = type(error).__name__
    status = getattr(error, "status_code", None)

    app.logger.error("AI request failed: %s: %s", name, error)

    if status == 429 or "RateLimit" in name:
        return ApiError(
            "The AI service is busy right now. Wait a moment and try again.", 429
        )

    if status in (401, 403) or "Authentication" in name or "PermissionDenied" in name:
        return ApiError(
            "The AI service rejected the API key. Check API_KEY in your .env file.", 502
        )

    if "Timeout" in name or "Connection" in name:
        return ApiError(
            "Couldn't reach the AI service. Check your internet connection and try again.", 503
        )

    return ApiError("The AI service returned an error. Try again in a moment.", 502)


def ask_ai(prompt, json_mode=False, history=None, system=None):

    if not client:
        raise ApiError(
            "The AI isn't set up yet. Add your Groq API key to the .env file as API_KEY.",
            503
        )

    if current_user.is_authenticated:
        key = f"ai:{current_user.id}"

        if limiter.blocked(key, AI_LIMIT, AI_WINDOW):
            raise ApiError(
                "You're sending requests quickly. Wait a minute, then try again.",
                429
            )

        limiter.hit(key, AI_WINDOW)

    messages = [{"role": "system", "content": system or DEFAULT_SYSTEM}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": prompt})

    params = {
        "model": MODEL,
        "messages": messages,
        "max_completion_tokens": 6000
    }

    if json_mode:
        params["response_format"] = {"type": "json_object"}

    try:
        response = client.chat.completions.create(**params)
    except Exception as error:
        raise map_ai_error(error)

    result = response.choices[0].message.content

    if not result or not result.strip():
        raise ApiError("The AI returned an empty answer. Try again.", 502)

    return result


def extract_json(raw):

    raw = raw.strip()

    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()

    for index, char in enumerate(raw):
        if char == "{":
            try:
                result, _ = decoder.raw_decode(raw[index:])
                return result
            except json.JSONDecodeError:
                continue

    raise ValueError("Invalid JSON returned by AI.")


def ask_ai_json(prompt, parse, wanted):
    """Ask for JSON and try once more if the result is unusable or short."""

    best = []

    for _ in range(2):
        try:
            items = parse(extract_json(ask_ai(prompt, json_mode=True)))
        except ValueError:
            continue

        if len(items) > len(best):
            best = items

        if len(best) >= wanted:
            break

    if not best:
        raise ApiError(
            "The AI didn't return a usable answer. Try again.", 502
        )

    return best


# =====================================================
# 8. PAGES, REGISTRATION AND LOGIN
# =====================================================

@app.route("/")
@login_required
def home():
    return render_template("dashboard.html")


@app.route("/tutor")
@login_required
def tutor_page():
    return render_template("tutor.html", modes=list(TUTOR_MODES))


@app.route("/quiz")
@login_required
def quiz_page():
    return render_template("quiz.html")


@app.route("/pdf")
@login_required
def pdf_page():
    return render_template("pdf.html")


@app.route("/planner")
@login_required
def planner():
    return render_template("planner.html")


@app.route("/flashcards")
@login_required
def flashcards_page():
    return render_template("flashcards.html")


@app.route("/analytics")
@login_required
def analytics():
    return render_template("analytics.html")


@app.route("/register", methods=["GET", "POST"])
def register():

    if current_user.is_authenticated:
        return redirect(url_for("home"))

    if request.method == "POST":

        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm", password)

        if not username or not email or not password:
            flash("Fill in every field.", "error")
            return render_template("register.html"), 400

        if not 2 <= len(username) <= 40:
            flash("Your name must be 2 to 40 characters.", "error")
            return render_template("register.html"), 400

        if len(email) > 254 or not EMAIL_PATTERN.match(email):
            flash("Enter a valid email address.", "error")
            return render_template("register.html"), 400

        if len(password) < 6:
            flash("Use a password with at least 6 characters.", "error")
            return render_template("register.html"), 400

        if password != confirm:
            flash("The two passwords don't match.", "error")
            return render_template("register.html"), 400

        db = get_db()

        try:
            existing = db.execute(
                "SELECT id FROM users WHERE email = ?",
                (email,)
            ).fetchone()

            if existing:
                flash("That email already has an account. Log in instead.", "error")
                return render_template("register.html"), 409

            db.execute("""
                INSERT INTO users (username, email, password, created_at)
                VALUES (?, ?, ?, ?)
            """, (
                username,
                email,
                generate_password_hash(password),
                datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            ))

            db.commit()

            flash("Account created. Log in to start studying.", "success")
            return redirect(url_for("login"))

        except sqlite3.Error:
            app.logger.exception("Registration failed")
            flash("We couldn't create your account. Try again.", "error")
            return render_template("register.html"), 500

        finally:
            db.close()

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():

    if current_user.is_authenticated:
        return redirect(url_for("home"))

    if request.method == "POST":

        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        remember = bool(request.form.get("remember"))
        next_url = request.form.get("next", "")

        throttle_key = f"login:{request.remote_addr}"

        if limiter.blocked(throttle_key, LOGIN_LIMIT, LOGIN_WINDOW):
            flash("Too many failed attempts. Wait a few minutes and try again.", "error")
            return render_template("login.html", next=next_url), 429

        db = get_db()

        try:
            user = db.execute(
                "SELECT * FROM users WHERE email = ?",
                (email,)
            ).fetchone()

            if user and user["password"] and check_password_hash(
                user["password"], password
            ):
                login_user(
                    User(user["id"], user["username"] or "Student", user["email"]),
                    remember=remember
                )

                return redirect(next_url if is_safe_next(next_url) else url_for("home"))

            limiter.hit(throttle_key, LOGIN_WINDOW)
            flash("Incorrect email or password.", "error")

        finally:
            db.close()

        return render_template("login.html", next=next_url), 401

    return render_template("login.html", next=request.args.get("next", ""))


@app.route("/logout", methods=["POST"])
@login_required
def logout():

    logout_user()
    return redirect(url_for("login"))


# =====================================================
# 9. PROFILE
# =====================================================

@app.route("/profile")
@login_required
def profile():

    db = get_db()

    try:
        row = db.execute(
            "SELECT created_at FROM users WHERE id = ?",
            (current_user.id,)
        ).fetchone()

        totals = db.execute("""
            SELECT
                (SELECT COUNT(*) FROM activities WHERE user_id = :u) AS activities,
                (SELECT COUNT(*) FROM flashcards WHERE user_id = :u) AS flashcards,
                (SELECT COUNT(*) FROM quiz_results WHERE user_id = :u) AS quizzes,
                (SELECT COUNT(*) FROM study_tasks WHERE user_id = :u) AS tasks
        """, {"u": current_user.id}).fetchone()

        return render_template(
            "profile.html",
            member_since=iso_utc(row["created_at"]) if row else None,
            totals=dict(totals)
        )

    finally:
        db.close()


@app.route("/api/profile", methods=["PATCH", "DELETE"])
@login_required
@api
def profile_api():

    data = json_body()
    db = get_db()

    try:
        if request.method == "PATCH":

            username = clean(data.get("username"), 40)

            if not 2 <= len(username) <= 40:
                raise ApiError("Your name must be 2 to 40 characters.")

            db.execute(
                "UPDATE users SET username = ? WHERE id = ?",
                (username, current_user.id)
            )
            db.commit()

            return jsonify({"message": "Name updated.", "username": username})

        password = str(data.get("password", ""))

        user = db.execute(
            "SELECT password FROM users WHERE id = ?",
            (current_user.id,)
        ).fetchone()

        if not user or not check_password_hash(user["password"], password):
            raise ApiError("That password is incorrect.", 403)

        for table in ("activities", "study_tasks", "flashcards", "quiz_results"):
            db.execute(f"DELETE FROM {table} WHERE user_id = ?", (current_user.id,))

        db.execute("DELETE FROM users WHERE id = ?", (current_user.id,))
        db.commit()

    finally:
        db.close()

    logout_user()

    return jsonify({
        "message": "Account deleted.",
        "redirect": url_for("register")
    })


@app.route("/api/profile/password", methods=["POST"])
@login_required
@api
def change_password():

    data = json_body()

    current = str(data.get("current_password", ""))
    new = str(data.get("new_password", ""))

    if len(new) < 6:
        raise ApiError("Use a new password with at least 6 characters.")

    db = get_db()

    try:
        user = db.execute(
            "SELECT password FROM users WHERE id = ?",
            (current_user.id,)
        ).fetchone()

        if not user or not check_password_hash(user["password"], current):
            raise ApiError("Your current password is incorrect.", 403)

        db.execute(
            "UPDATE users SET password = ? WHERE id = ?",
            (generate_password_hash(new), current_user.id)
        )
        db.commit()

    finally:
        db.close()

    return jsonify({"message": "Password changed."})


# =====================================================
# 10. AI TUTOR
# =====================================================

def clean_history(raw):

    history = []

    if isinstance(raw, list):
        for message in raw[-8:]:
            if (
                isinstance(message, dict)
                and message.get("role") in ("user", "assistant")
                and isinstance(message.get("content"), str)
                and message["content"].strip()
            ):
                history.append({
                    "role": message["role"],
                    "content": message["content"][:4000]
                })

    return history


@app.route("/api/ask", methods=["POST"])
@login_required
@api
def ai_tutor():

    data = json_body()

    question = clean(data.get("question"), 4000)
    mode = clean(data.get("mode"), 40)

    if not question:
        raise ApiError("Type a question first.")

    if mode not in TUTOR_MODES:
        mode = "Explain"

    system = (
        f"{DEFAULT_SYSTEM} {TUTOR_MODES[mode]} "
        "Write in Markdown: short headings, bullet or numbered lists, and "
        "tables where they help. Write maths in plain text, not LaTeX. "
        "If the student's earlier messages are relevant, build on them."
    )

    answer = ask_ai(
        question,
        history=clean_history(data.get("history")),
        system=system
    )

    save_activity("tutor", f"Asked: {question[:80]}")

    return jsonify({"answer": answer})


# =====================================================
# 11. QUIZ GENERATOR
# =====================================================

def parse_answer_index(answer, options):

    if isinstance(answer, bool):
        return None

    if isinstance(answer, int):
        return answer if 0 <= answer <= 3 else None

    if isinstance(answer, float) and answer.is_integer():
        return int(answer) if 0 <= answer <= 3 else None

    if isinstance(answer, str):
        text = answer.strip()

        if text.isdigit():
            return int(text) if 0 <= int(text) <= 3 else None

        if len(text) == 1 and text.upper() in "ABCD":
            return "ABCD".index(text.upper())

        for index, option in enumerate(options):
            if option.strip().lower() == text.lower():
                return index

    return None


NO_SHUFFLE = re.compile(r"\b(all|none) of the above\b|\bboth\b", re.IGNORECASE)


def parse_questions(data):

    items = data.get("questions") if isinstance(data, dict) else None

    if not isinstance(items, list):
        raise ValueError("Invalid quiz response.")

    valid = []
    seen = set()

    for item in items:

        if not isinstance(item, dict):
            continue

        question = item.get("question")
        options = item.get("options")

        if not isinstance(question, str) or not question.strip():
            continue

        if not isinstance(options, list) or len(options) != 4:
            continue

        if not all(isinstance(o, str) and o.strip() for o in options):
            continue

        options = [o.strip() for o in options]

        if len({o.lower() for o in options}) != 4:
            continue

        answer = parse_answer_index(item.get("answer"), options)

        if answer is None:
            continue

        key = question.strip().lower()

        if key in seen:
            continue

        seen.add(key)

        # Models like to put the right answer first, so shuffle it,
        # unless an option refers to the others ("all of the above").
        if not any(NO_SHUFFLE.search(o) for o in options):
            order = list(range(4))
            random.shuffle(order)
            options = [options[i] for i in order]
            answer = order.index(answer)

        valid.append({
            "question": question.strip(),
            "options": options,
            "answer": answer,
            "explanation": str(item.get("explanation", "")).strip()
        })

    return valid


@app.route("/api/quiz", methods=["POST"])
@login_required
@api
def generate_quiz():

    data = json_body()

    topic = clean(data.get("topic"), 120)
    material = clean(data.get("material"), MAX_MATERIAL_CHARS)
    difficulty = clean(data.get("difficulty"), 10)
    count = int_field(data.get("count", 5), "question count")

    if not topic and not material:
        raise ApiError("Enter a topic or paste some notes.")

    if not 1 <= count <= 30:
        raise ApiError("Choose between 1 and 30 questions.")

    if difficulty not in ("Easy", "Medium", "Hard"):
        difficulty = "Medium"

    source = (
        f"Base every question only on these study notes:\n{material}"
        if material else ""
    )

    prompt = f"""
Generate exactly {count} multiple-choice questions.

Topic: {topic or "the study notes below"}
Difficulty: {difficulty}
{source}

Requirements:
- Four options per question.
- Exactly one correct option.
- "answer" must be the integer index (0 to 3) of the correct option.
- Include a short explanation of why the answer is correct.
- Do not repeat questions.
- Return valid JSON only.

Format:
{{
 "questions": [
  {{
   "question": "Question",
   "options": ["A", "B", "C", "D"],
   "answer": 0,
   "explanation": "Explanation"
  }}
 ]
}}
"""

    questions = ask_ai_json(prompt, parse_questions, count)[:count]

    save_activity("quiz", f"Generated quiz: {topic or 'Your notes'}")

    response = {"questions": questions}

    if len(questions) < count:
        response["warning"] = (
            f"The AI returned {len(questions)} of the {count} questions you asked for."
        )

    return jsonify(response)


@app.route("/api/quiz-result", methods=["POST"])
@login_required
@api
def save_quiz_result():

    data = json_body()

    topic = clean(data.get("topic"), 120)
    score = int_field(data.get("score", -1), "score")
    total = int_field(data.get("total", 0), "total")

    if not topic or total < 1 or not 0 <= score <= total:
        raise ApiError("That quiz result isn't valid.")

    percentage = round(score / total * 100, 2)

    db = get_db()

    try:
        db.execute("""
            INSERT INTO quiz_results
            (user_id, topic, score, total, percentage)
            VALUES (?, ?, ?, ?, ?)
        """, (current_user.id, topic, score, total, percentage))

        db.commit()

    finally:
        db.close()

    save_activity("result", f"Scored {score}/{total} on {topic}")

    return jsonify({
        "message": "Quiz result saved.",
        "percentage": percentage
    })


# =====================================================
# 12. PDF INTELLIGENCE
# =====================================================

@app.route("/api/pdf", methods=["POST"])
@login_required
@api
def summarize_pdf():

    file = request.files.get("file")

    if not file or not file.filename:
        raise ApiError("Choose a PDF first.")

    if not file.filename.lower().endswith(".pdf"):
        raise ApiError("Only PDF files are supported.")

    content = file.read()

    if not content:
        raise ApiError("That file is empty.")

    if b"%PDF" not in content[:1024]:
        raise ApiError("That file doesn't look like a PDF.")

    try:
        document = pymupdf.open(stream=content, filetype="pdf")
    except Exception:
        raise ApiError("Couldn't open this PDF. The file may be damaged.")

    try:
        if document.needs_pass:
            raise ApiError(
                "This PDF is password protected. Remove the password and upload it again."
            )

        pages = document.page_count
        parts = []
        length = 0

        for page in document:
            page_text = page.get_text()
            parts.append(page_text)
            length += len(page_text)

            if length > MAX_PDF_CHARS:
                break

        text = "\n".join(parts)

    finally:
        document.close()

    if not text.strip():
        raise ApiError(
            "No readable text found. Scanned PDFs (photos of pages) aren't supported yet."
        )

    truncated = len(text) > MAX_PDF_CHARS
    text = text[:MAX_PDF_CHARS]

    prompt = f"""
Summarize this study material for a student.

Use Markdown with these sections:
## Main topic
## Important concepts
## Key points
## Definitions
## Conclusion

Use simple, student-friendly language.

PDF CONTENT:
{text}
"""

    summary = ask_ai(prompt)

    save_activity("pdf", f"Summarized {file.filename[:80]}")

    return jsonify({
        "summary": summary,
        "filename": file.filename,
        "pages": pages,
        "truncated": truncated
    })


# =====================================================
# 13. STUDY PLANNER
# =====================================================

@app.route("/api/tasks", methods=["GET", "POST"])
@login_required
@api
def tasks():

    db = get_db()

    try:
        if request.method == "POST":

            data = json_body()

            subject = clean(data.get("subject"), 80)
            topic = clean(data.get("topic"), 200)
            due_date = clean(data.get("due_date"), 10)

            if not subject or not topic:
                raise ApiError("Enter a subject and a topic.")

            if due_date and not valid_date(due_date):
                raise ApiError("That due date isn't valid.")

            cursor = db.execute("""
                INSERT INTO study_tasks
                (user_id, subject, topic, due_date)
                VALUES (?, ?, ?, ?)
            """, (current_user.id, subject, topic, due_date))

            db.commit()

            save_activity("planner", f"Added task: {topic[:80]}")

            return jsonify({
                "message": "Task added.",
                "id": cursor.lastrowid
            })

        rows = db.execute("""
            SELECT * FROM study_tasks
            WHERE user_id = ?
            ORDER BY
                completed ASC,
                (due_date IS NULL OR due_date = '') ASC,
                due_date ASC,
                id DESC
        """, (current_user.id,)).fetchall()

        return jsonify({"tasks": [dict(row) for row in rows]})

    finally:
        db.close()


@app.route("/api/tasks/<int:task_id>", methods=["PATCH", "DELETE"])
@login_required
@api
def update_task(task_id):

    db = get_db()

    try:
        task = db.execute("""
            SELECT * FROM study_tasks
            WHERE id = ? AND user_id = ?
        """, (task_id, current_user.id)).fetchone()

        if not task:
            raise ApiError("Task not found.", 404)

        if request.method == "DELETE":

            db.execute("""
                DELETE FROM study_tasks
                WHERE id = ? AND user_id = ?
            """, (task_id, current_user.id))

            db.commit()

            return jsonify({"message": "Task deleted."})

        data = json_body()

        subject = task["subject"]
        topic = task["topic"]
        due_date = task["due_date"] or ""
        completed = task["completed"]

        if "completed" in data:
            if not isinstance(data["completed"], bool):
                raise ApiError("Invalid completion status.")
            completed = int(data["completed"])

        if "subject" in data:
            subject = clean(data["subject"], 80)

        if "topic" in data:
            topic = clean(data["topic"], 200)

        if "due_date" in data:
            due_date = clean(data["due_date"], 10)

            if due_date and not valid_date(due_date):
                raise ApiError("That due date isn't valid.")

        if not subject or not topic:
            raise ApiError("Enter a subject and a topic.")

        db.execute("""
            UPDATE study_tasks
            SET subject = ?, topic = ?, due_date = ?, completed = ?
            WHERE id = ? AND user_id = ?
        """, (subject, topic, due_date, completed, task_id, current_user.id))

        db.commit()

        return jsonify({"message": "Task updated."})

    finally:
        db.close()


# =====================================================
# 14. FLASHCARDS
# =====================================================

def parse_cards(data):

    items = data.get("flashcards") if isinstance(data, dict) else None

    if not isinstance(items, list):
        raise ValueError("Invalid flashcard response.")

    valid = []
    seen = set()

    for card in items:

        if not isinstance(card, dict):
            continue

        question = card.get("question")
        answer = card.get("answer")

        if (
            isinstance(question, str) and isinstance(answer, str)
            and question.strip() and answer.strip()
        ):
            key = question.strip().lower()

            if key in seen:
                continue

            seen.add(key)

            valid.append({
                "question": question.strip()[:500],
                "answer": answer.strip()[:2000]
            })

    return valid


def insert_cards(db, cards, default_topic):
    """Insert cards for the current user and return them with their ids."""

    saved = []

    for card in cards:

        topic = clean(card.get("topic"), 120) or default_topic

        cursor = db.execute("""
            INSERT INTO flashcards
            (user_id, question, answer, topic)
            VALUES (?, ?, ?, ?)
        """, (current_user.id, card["question"], card["answer"], topic))

        saved.append({
            "id": cursor.lastrowid,
            "question": card["question"],
            "answer": card["answer"],
            "topic": topic
        })

    return saved


@app.route("/api/flashcards", methods=["GET", "POST"])
@login_required
@api
def flashcard_api():

    db = get_db()

    try:
        if request.method == "GET":

            rows = db.execute("""
                SELECT * FROM flashcards
                WHERE user_id = ?
                ORDER BY id DESC
            """, (current_user.id,)).fetchall()

            return jsonify({"flashcards": [dict(row) for row in rows]})

        data = json_body()

        # Save cards the student already has (typed in, or missed in a quiz).
        if isinstance(data.get("cards"), list) or "question" in data:

            raw = data["cards"] if isinstance(data.get("cards"), list) else [data]

            cards = []

            for item in raw[:50]:
                if not isinstance(item, dict):
                    continue

                question = clean(item.get("question"), 500)
                answer = clean(item.get("answer"), 2000)

                if question and answer:
                    cards.append({
                        "question": question,
                        "answer": answer,
                        "topic": item.get("topic")
                    })

            if not cards:
                raise ApiError("Enter both a question and an answer.")

            saved = insert_cards(
                db, cards, clean(data.get("topic"), 120) or "My cards"
            )
            db.commit()

            return jsonify({"success": True, "flashcards": saved})

        # Otherwise generate cards with the AI.
        topic = clean(data.get("topic"), 120)
        material = clean(data.get("material"), MAX_MATERIAL_CHARS)
        count = int_field(data.get("count", 10), "flashcard count")

        if not topic and not material:
            raise ApiError("Enter a topic or paste some study material.")

        if not 1 <= count <= 20:
            raise ApiError("Choose between 1 and 20 flashcards.")

        prompt = f"""
Create exactly {count} useful academic flashcards.

Topic: {topic or "Use the supplied material"}

Study material:
{material or "No additional material."}

Requirements:
- Clear questions.
- Accurate, concise answers.
- Do not repeat questions.
- Cover the important concepts.
- Return valid JSON only.

Format:
{{
 "flashcards": [
  {{
   "question": "Question?",
   "answer": "Answer."
  }}
 ]
}}
"""

        cards = ask_ai_json(prompt, parse_cards, count)[:count]
        label = topic or "Study material"

        saved = insert_cards(db, cards, label)
        db.commit()

        save_activity("flashcards", f"Generated cards: {label}")

        response = {"success": True, "flashcards": saved}

        if len(saved) < count:
            response["warning"] = (
                f"The AI returned {len(saved)} of the {count} cards you asked for."
            )

        return jsonify(response)

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


@app.route("/api/flashcards/<int:card_id>", methods=["PATCH", "DELETE"])
@login_required
@api
def flashcard_item(card_id):

    db = get_db()

    try:
        card = db.execute("""
            SELECT * FROM flashcards
            WHERE id = ? AND user_id = ?
        """, (card_id, current_user.id)).fetchone()

        if not card:
            raise ApiError("Flashcard not found.", 404)

        if request.method == "DELETE":

            db.execute("""
                DELETE FROM flashcards
                WHERE id = ? AND user_id = ?
            """, (card_id, current_user.id))

            db.commit()

            return jsonify({"message": "Flashcard deleted."})

        data = json_body()

        question = clean(data.get("question", card["question"]), 500)
        answer = clean(data.get("answer", card["answer"]), 2000)
        topic = clean(data.get("topic", card["topic"] or ""), 120)

        if not question or not answer:
            raise ApiError("Enter both a question and an answer.")

        db.execute("""
            UPDATE flashcards
            SET question = ?, answer = ?, topic = ?
            WHERE id = ? AND user_id = ?
        """, (question, answer, topic or "My cards", card_id, current_user.id))

        db.commit()

        return jsonify({"message": "Flashcard updated."})

    finally:
        db.close()


# =====================================================
# 15. PERFORMANCE ANALYTICS
# =====================================================

@app.route("/api/analytics")
@login_required
@api
def analytics_api():

    db = get_db()

    try:
        results = db.execute("""
            SELECT topic, score, total, percentage, created_at
            FROM quiz_results
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 50
        """, (current_user.id,)).fetchall()

        totals = db.execute("""
            SELECT
                COUNT(*) AS attempts,
                AVG(percentage) AS average,
                MAX(percentage) AS best,
                COALESCE(SUM(score), 0) AS correct,
                COALESCE(SUM(total), 0) AS answered
            FROM quiz_results
            WHERE user_id = ?
        """, (current_user.id,)).fetchone()

        topics = db.execute("""
            SELECT
                topic,
                COUNT(*) AS attempts,
                AVG(percentage) AS average,
                MAX(percentage) AS best
            FROM quiz_results
            WHERE user_id = ?
            GROUP BY topic COLLATE NOCASE
            ORDER BY average ASC
        """, (current_user.id,)).fetchall()

        history = []

        for row in results:
            item = dict(row)
            item["created_at"] = iso_utc(item["created_at"])
            history.append(item)

        return jsonify({
            "attempts": totals["attempts"] or 0,
            "average": round(totals["average"] or 0, 2),
            "best": round(totals["best"] or 0, 2),
            "correct": totals["correct"],
            "answered": totals["answered"],
            "topics": [
                {
                    "topic": row["topic"],
                    "attempts": row["attempts"],
                    "average": round(row["average"] or 0, 2),
                    "best": round(row["best"] or 0, 2)
                }
                for row in topics
            ],
            "history": history
        })

    finally:
        db.close()


# =====================================================
# 16. DASHBOARD STATISTICS
# =====================================================

@app.route("/api/dashboard-stats")
@login_required
@api
def dashboard_stats():

    db = get_db()

    try:
        counts = db.execute("""
            SELECT
                SUM(CASE WHEN activity_type = 'tutor'
                    THEN 1 ELSE 0 END) AS tutor,
                SUM(CASE WHEN activity_type = 'quiz'
                    THEN 1 ELSE 0 END) AS quiz,
                SUM(CASE WHEN activity_type = 'pdf'
                    THEN 1 ELSE 0 END) AS pdf,
                SUM(CASE WHEN activity_type = 'flashcards'
                    THEN 1 ELSE 0 END) AS flashcards
            FROM activities
            WHERE user_id = ?
        """, (current_user.id,)).fetchone()

        recent = db.execute("""
            SELECT activity_type, description, created_at
            FROM activities
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 6
        """, (current_user.id,)).fetchall()

        tasks_count = db.execute("""
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(completed), 0) AS completed
            FROM study_tasks
            WHERE user_id = ?
        """, (current_user.id,)).fetchone()

        upcoming = db.execute("""
            SELECT id, subject, topic, due_date
            FROM study_tasks
            WHERE user_id = ? AND completed = 0
            ORDER BY
                (due_date IS NULL OR due_date = '') ASC,
                due_date ASC,
                id DESC
            LIMIT 5
        """, (current_user.id,)).fetchall()

        quiz = db.execute("""
            SELECT COUNT(*) AS attempts, AVG(percentage) AS average
            FROM quiz_results
            WHERE user_id = ?
        """, (current_user.id,)).fetchone()

        last_quiz = db.execute("""
            SELECT topic, score, total, percentage
            FROM quiz_results
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
        """, (current_user.id,)).fetchone()

        cards_total = db.execute(
            "SELECT COUNT(*) AS n FROM flashcards WHERE user_id = ?",
            (current_user.id,)
        ).fetchone()

        return jsonify({
            "counts": {
                "tutor": counts["tutor"] or 0,
                "quiz": counts["quiz"] or 0,
                "pdf": counts["pdf"] or 0,
                "flashcards": counts["flashcards"] or 0,
                "cards_total": cards_total["n"] or 0,
                "tasks": tasks_count["total"] or 0,
                "completed_tasks": tasks_count["completed"] or 0
            },
            "quiz": {
                "attempts": quiz["attempts"] or 0,
                "average": round(quiz["average"] or 0, 1),
                "last": dict(last_quiz) if last_quiz else None
            },
            "upcoming": [dict(row) for row in upcoming],
            "recent": [
                {
                    "activity": row["activity_type"],
                    "title": row["description"],
                    "created_at": iso_utc(row["created_at"])
                }
                for row in recent
            ]
        })

    finally:
        db.close()


# =====================================================
# 17. ERROR HANDLERS
# =====================================================

def error_response(code, title, message):

    if request.path.startswith("/api/"):
        return jsonify({"error": message}), code

    return render_template(
        "error.html", code=code, title=title, message=message
    ), code


@app.errorhandler(404)
def not_found(error):
    return error_response(
        404, "Page not found",
        "That page doesn't exist. It may have moved."
    )


@app.errorhandler(405)
def method_not_allowed(error):
    return error_response(
        405, "That action isn't allowed here",
        "Go back to the dashboard and try again."
    )


@app.errorhandler(413)
def too_large(error):
    return error_response(
        413, "File too large", "The maximum upload size is 10 MB."
    )


@app.errorhandler(500)
def server_error(error):
    return error_response(
        500, "Something went wrong",
        "The server hit an error. Try again in a moment."
    )


# =====================================================
# 18. START SERVER
# =====================================================

if __name__ == "__main__":

    print("\n================================")
    print("       NEXMIND AI PLATFORM")
    print("================================")
    print("Database:", DATABASE)
    print("Groq:", "Connected" if client else "API KEY MISSING")

    if SECRET_KEY_WARNING:
        print("Warning:", SECRET_KEY_WARNING)

    print("================================\n")

    app.run(
        host="127.0.0.1",
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "1") == "1"
    )
