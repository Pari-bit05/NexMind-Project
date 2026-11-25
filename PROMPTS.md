# Prompt Documentation

## 1. Initial project-building prompt (five parts)
Used as the first instruction in the first AI tool. **Tool used:** `<tool>`  **Date:** `<date>`

**ROLE:** You are a senior full-stack web developer and UX designer who specializes in building educational AI applications for engineering students. You write clean, well-commented, beginner-friendly code and explain your design decisions.

**TASK:** Build a complete, deployable website called StudyBuddy for Engineering, an AI-powered study assistant, with: (1) a Home page with a short introduction, the problem it solves and navigation; (2) a Topic Explainer (branch, subject, topic, level Beginner/Intermediate/Exam-Ready) giving a step-by-step explanation with an example; (3) a Quiz Generator (topic, number of questions) with MCQs, correct answers, short explanations and a "Check Answers" score; (4) a Revision Planner (exam date, subjects/topics) giving a day-by-day timetable; (5) an AI Chatbot Tutor available on every page that answers study doubts through a real AI model API with no predefined replies; (6) an About page.

**CONTEXT:** Many second-year engineering students struggle to understand difficult concepts, get no personalised practice and plan revision poorly. Textbooks are dense and tutors are expensive or unavailable. The target audience is undergraduate engineering students, mainly in their first and second years. This is a college project for a Prompt Engineering course, so the code must be easy to understand and explain in a viva.

**CONSTRAINTS:** HTML, CSS and JavaScript with a Node.js serverless API route for Vercel. All AI features call an AI API from the backend; the API key is never in front-end code and is read from environment variables (include `.env.example`). The chatbot answers only study questions, keeps session history, shows a typing indicator and handles empty input, long input, network failure, API errors and rate limits with friendly messages. Keep each feature's system prompt in a clearly commented place. Clean, responsive design with dark mode. Modular, commented code, no unnecessary libraries. No login or database. Sanitise input and never expose secrets.

**OUTPUT FORMAT:** (1) project summary and site structure; (2) folder tree; (3) full source code for every file in labelled code blocks; (4) a README.md with description, objectives, features, tech stack, setup, Vercel deployment and placeholders for screenshots and prompt documentation; (5) five next improvements; (6) local run and deployment steps. State assumptions before the code.

**How each part shaped the result**
- Role: set the code style (clean, commented, beginner-friendly).
- Task: defined the six pages and features.
- Context: set the audience, tone and difficulty levels.
- Constraints: produced the serverless key-hiding design, error handling and dark mode.
- Output Format: produced the folder tree, labelled files and README.

## 2. Prompt refinements log
| # | Tool | Prompt (summary) | Problem with previous output | Change made | Result |
|---|---|---|---|---|---|
| 1 | `<tool>` | Initial five-part prompt above | - | - | First working site with chatbot |
| 2 | `<tool>` | Connect Claude, Gemini and Perplexity; give each a clear job | Only one AI was used | Added per-feature routing and a Perplexity resources feature | Three AIs integrated |
| 3 | `<tool>` | The AI should give an answer instead of just an error | Failures showed an error message | Added backup order across all three AIs, JSON validation for quizzes, one automatic retry | Fewer visible errors |
| 4 | `<tool>` | `<add your own prompts here>` | | | |

## 3. Prompt engineering techniques used
- **Role-based prompting:** every system prompt in `api/chat.js` starts with a role (tutor, exam-setter, study planner, research assistant).
- **Structured prompting:** the quiz prompt forces a JSON array with a fixed schema, which the page can parse reliably.
- **Context-based prompting:** branch, subject, level, exam date and study hours are passed with each request.
- **Constraint-setting:** the chatbot prompt restricts answers to academic topics.
- **Chain/step-by-step prompting:** `<describe how you built the site in stages>`
- **Reverse prompting / response evaluation:** `<describe how you checked AI output and corrected it>`

## 4. Before/after example
Add one example showing how a refined prompt improved the output (quality, accuracy or usefulness).

## 5. Errors and fixes
| Error / challenge | Cause | Fix |
|---|---|---|
| `<e.g. nav menu stacked vertically on phones>` | `<cause>` | `<fix>` |
