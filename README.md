<<<<<<< HEAD
# NexMind

AI study platform: tutor, quizzes, PDF summaries, flashcards, study planner, analytics, profile.

## Run
```
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env    # then add your Groq API key and a real SECRET_KEY
python app.py           # http://127.0.0.1:5000
```
Your existing `nexmind.db` keeps working; put it next to `app.py`.

## Notes
- Set `FLASK_DEBUG=0` for anything other than local development.
- Logout is now a POST (button in the sidebar), and all writes need a CSRF token.
- Rate limits are in memory and reset on restart.
- Scanned (image-only) PDFs aren't supported.
=======
# StudyBuddy for Engineering

An AI-powered study assistant for engineering students, built for the **Prompt Engineering** course (Semester 3).

**Live website:** `<add your Vercel URL>`
**Team:** `<member 1>`, `<member 2>`, `<member 3>`, `<member 4>`

## Problem and objectives
Engineering concepts are hard to learn from dense textbooks, students get little personalised practice, and revision is often planned at the last minute. StudyBuddy aims to:
- explain topics in plain language at the student's level,
- generate practice quizzes with instant scoring,
- build day-by-day revision plans from an exam date,
- answer doubts through an AI chatbot tutor.

**Target audience:** first- and second-year undergraduate engineering students.

## Features
| Feature | What it does | AI used |
|---|---|---|
| Explain a topic | Step-by-step explanation with an example (Beginner / Intermediate / Exam-Ready) | Claude |
| Find study resources | Current learning resources with source links | Perplexity |
| Quiz me | MCQs with answers, explanations and a score | Gemini |
| Plan revision | Day-by-day timetable from exam date, topics and daily hours | Gemini |
| Ask tutor (chatbot) | Floating chat on every page, remembers the session, study questions only | Claude |
| Dark mode, responsive layout | Works on phones and desktops | - |

**Reliability:** every feature has backup AIs. If one provider fails, the next is tried automatically, and the user sees an error only if all fail. The chatbot validates empty and over-long input and shows friendly API-error messages.

## Technologies and AI tools
- **Front end:** HTML, CSS, JavaScript (single `index.html`)
- **Back end:** Node.js serverless function on Vercel (`api/chat.js`) that keeps API keys off the browser
- **AI APIs:** Anthropic Claude, Google Gemini, Perplexity Sonar
- **Development tools:** `<list the AI tools used while building and what each did, e.g. Claude: initial site + chatbot code; Gemini: ...; Perplexity: ...>`

## How the chatbot works
1. The browser sends `{mode, input, history}` to `/api/chat`.
2. The server validates the input, picks the system prompt for that mode, and calls the preferred AI API with the key from environment variables.
3. If the call fails, it tries the next AI in the backup order, then returns the reply and which AI answered.
4. The page shows the reply (or a friendly error) in the chat window.

## Screenshots
| Home | Chatbot |
|---|---|
| ![Home](screenshots/home.png) | ![Chatbot](screenshots/chatbot.png) |

> Replace these with screenshots of the deployed site.

## Prompt documentation
See [docs/PROMPTS.md](docs/PROMPTS.md) for the initial five-part prompt, refined prompts, the techniques used, and the system prompts in `api/chat.js`.

## Run locally
```bash
npm i -g vercel
cp .env.example .env        # then add your three API keys
vercel dev                  # opens http://localhost:3000
```
Opening `index.html` directly shows the interface, but the AI features need `/api/chat`.

## Deploy on Vercel
1. Push this repo to GitHub.
2. In Vercel, choose **Add New > Project** and import the repo.
3. Under **Settings > Environment Variables** add `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` and `PERPLEXITY_API_KEY`.
4. Deploy, then test every feature and the chatbot.

**Never commit real API keys.** `.env` is listed in `.gitignore`.

## Folder structure
```
index.html         front end
api/chat.js        serverless AI router (Claude, Gemini, Perplexity)
docs/PROMPTS.md    prompt documentation
screenshots/       website screenshots
.env.example       key template
```
>>>>>>> 42d9e77e2880e8a13ee67d5e9b847d9cd21399e2
