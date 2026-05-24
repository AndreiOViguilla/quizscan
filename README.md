# QuizScan

**Turn any content into a quiz — instantly.**

QuizScan is an AI-powered quiz generator that transforms PDFs, images, text, URLs, YouTube videos, or any topic into interactive quizzes, study guides, and flashcards. Built with a clean ChatGPT-inspired dark UI.

---

## Features

- **Multiple input types** — PDF, image, text, URL, YouTube, or just a topic
- **Three study modes** — Quiz, Study (Q&A side by side), Flashcards
- **AI-generated questions** — powered by Groq (Llama 3.3 70B)
- **Question types** — Multiple choice, True/False, Fill in the blank, or Mixed
- **Multiplayer** — Real-time rooms via Firebase. Share a 4-letter code, play live with friends across any device
- **Review & edit** — Fix AI mistakes before starting
- **Leaderboard & history** — Track scores and past quizzes
- **Dark/light mode** — Clean, minimal ChatGPT-style UI
- **YouTube transcript** — Pulls real captions from YouTube videos via the YouTube Data API
- **Auto-difficulty** — Adapts question difficulty based on your performance
- **Streak & timer** — Optional game mechanics to make it competitive

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (Create React App) |
| AI Backend | Groq API — Llama 3.3 70B |
| Multiplayer | Firebase Realtime Database |
| YouTube | YouTube Data API v3 |
| Deployment | Vercel |

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/quizscan.git
cd quizscan
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the root:

```env
REACT_APP_GROQ_KEY=your_groq_api_key
REACT_APP_YOUTUBE_API_KEY=your_youtube_api_key
```

- **Groq key** — free at [console.groq.com](https://console.groq.com)
- **YouTube API key** — free at [Google Cloud Console](https://console.cloud.google.com) → enable YouTube Data API v3

### 4. Run locally

```bash
npm start
```

Opens at `http://localhost:3000`

---

## Deployment (Vercel)

1. Push to GitHub
2. Import repo at [vercel.com](https://vercel.com)
3. Add environment variables in Vercel project settings:
   - `REACT_APP_GROQ_KEY`
   - `REACT_APP_YOUTUBE_API_KEY`
4. Deploy

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REACT_APP_GROQ_KEY` | Yes | Groq API key for AI question generation |
| `REACT_APP_YOUTUBE_API_KEY` | No | Enables real YouTube transcript fetching |

---

## Project Structure

```
quizscan/
├── api/
│   └── transcript.js        # Vercel serverless function for YouTube transcripts
├── src/
│   ├── pages/
│   │   ├── HomePage.jsx     # Main input + settings page
│   │   ├── QuizPage.jsx     # Quiz gameplay
│   │   ├── EditPage.jsx     # Review & edit questions
│   │   ├── ResultsPage.jsx  # Score + review
│   │   ├── StudyPage.jsx    # Study mode
│   │   ├── FlashcardPage.jsx
│   │   ├── MultiplayerPage.jsx
│   │   ├── LeaderboardPage.jsx
│   │   └── HistoryPage.jsx
│   ├── components/
│   │   └── Layout.jsx       # Header, footer, shared components
│   ├── context/
│   │   └── AppContext.js    # Global state
│   ├── utils/
│   │   ├── api.js           # Groq + Firebase + helpers
│   │   └── constants.js     # Config values
│   └── styles/
│       └── theme.js         # ChatGPT-style dark/light theme
├── .env                     # Local environment variables (git ignored)
├── vercel.json              # Vercel config
└── package.json
```

---

## Multiplayer

Multiplayer uses Firebase Realtime Database with no backend server required:

1. Generate a quiz → go to Settings → **Create Room**
2. Share the 4-letter code with friends
3. Friends go to the site → enter the code → **Join**
4. Host clicks **Start Game**
5. Everyone plays simultaneously, scores update in real time

Rooms automatically expire after **1 hour of inactivity**.

---

## License

MIT
