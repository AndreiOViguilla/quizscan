// Firebase database helpers for all features
const FB_URL = "https://quizscan-94acb-default-rtdb.asia-southeast1.firebasedatabase.app";

export async function fbGet(path) {
  const res = await fetch(`${FB_URL}${path}.json`);
  if (!res.ok) return null;
  return res.json();
}

export async function fbSet(path, data) {
  const res = await fetch(`${FB_URL}${path}.json`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function fbPush(path, data) {
  const res = await fetch(`${FB_URL}${path}.json`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function fbUpdate(path, data) {
  const res = await fetch(`${FB_URL}${path}.json`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function fbDelete(path) {
  await fetch(`${FB_URL}${path}.json`, { method: "DELETE" });
}

// ─── GLOBAL LEADERBOARD ───────────────────────────────────────────────────────
export async function saveScore(user, score, total, topic) {
  if (!user) return;
  const uid = user.uid;
  const existing = await fbGet(`/leaderboard/${uid}`);
  const entry = {
    name: user.displayName || user.email?.split("@")[0] || "Anonymous",
    avatar: user.photoURL || null,
    uid,
    score: (existing?.score || 0) + score,
    plays: (existing?.plays || 0) + 1,
    totalCorrect: (existing?.totalCorrect || 0) + score,
    totalQuestions: (existing?.totalQuestions || 0) + total,
    lastPlayed: Date.now(),
    lastTopic: topic || "Unknown",
  };
  await fbSet(`/leaderboard/${uid}`, entry);
}

export async function getLeaderboard() {
  const data = await fbGet("/leaderboard");
  if (!data) return [];
  return Object.values(data).sort((a, b) => b.score - a.score).slice(0, 50);
}

// ─── USER PROFILE ─────────────────────────────────────────────────────────────
export async function getUserProfile(uid) {
  const [profile, lb] = await Promise.all([
    fbGet(`/users/${uid}`),
    fbGet(`/leaderboard/${uid}`),
  ]);
  return { ...profile, ...lb };
}

export async function getUserSharedQuizzes(uid) {
  const all = await fbGet("/shared_quizzes");
  if (!all) return [];
  return Object.entries(all)
    .filter(([, q]) => q.uid === uid)
    .map(([id, q]) => ({ id, ...q }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ─── SHARED QUIZZES ───────────────────────────────────────────────────────────
export async function deleteSharedQuiz(id) {
  await fbDelete(`/shared_quizzes/${id}`);
}

export async function reportQuiz(id, reason, reporterUid) {
  await fbPush(`/reports/${id}`, { reason, reporterUid, createdAt: Date.now() });
  const quiz = await fbGet(`/shared_quizzes/${id}`);
  const reports = (quiz?.reportCount || 0) + 1;
  await fbUpdate(`/shared_quizzes/${id}`, { reportCount: reports });
}

// ─── DAILY CHALLENGE ──────────────────────────────────────────────────────────
export async function getDailyChallenge() {
  const today = new Date().toISOString().split("T")[0];
  return fbGet(`/daily/${today}`);
}

export async function setDailyChallenge(questions, topic) {
  const today = new Date().toISOString().split("T")[0];
  await fbSet(`/daily/${today}`, { questions, topic, createdAt: Date.now() });
}

export async function submitDailyScore(uid, name, score, total) {
  const today = new Date().toISOString().split("T")[0];
  await fbSet(`/daily/${today}/scores/${uid}`, { name, score, total, submittedAt: Date.now() });
}

export async function getDailyScores() {
  const today = new Date().toISOString().split("T")[0];
  const scores = await fbGet(`/daily/${today}/scores`);
  if (!scores) return [];
  return Object.values(scores).sort((a, b) => b.score - a.score);
}

// ─── ACHIEVEMENTS ─────────────────────────────────────────────────────────────
export const ACHIEVEMENTS = [
  { id: "first_quiz", label: "First Quiz", desc: "Complete your first quiz", icon: "★" },
  { id: "perfect_score", label: "Perfect Score", desc: "Get 100% on a quiz", icon: "◆" },
  { id: "streak_5", label: "On a Roll", desc: "Get 5 correct in a row", icon: "⬡" },
  { id: "shared_1", label: "Contributor", desc: "Share your first quiz", icon: "▲" },
  { id: "shared_10", label: "Top Contributor", desc: "Share 10 quizzes", icon: "▲▲" },
  { id: "plays_10", label: "Dedicated", desc: "Complete 10 quizzes", icon: "●" },
  { id: "plays_50", label: "Scholar", desc: "Complete 50 quizzes", icon: "●●" },
  { id: "daily_1", label: "Daily Player", desc: "Complete a daily challenge", icon: "◉" },
];

export async function getUserAchievements(uid) {
  const data = await fbGet(`/achievements/${uid}`);
  return data ? Object.keys(data) : [];
}

export async function unlockAchievement(uid, achievementId) {
  const existing = await fbGet(`/achievements/${uid}/${achievementId}`);
  if (existing) return false;
  await fbSet(`/achievements/${uid}/${achievementId}`, { unlockedAt: Date.now() });
  return true;
}

export async function checkAndUnlockAchievements(user, { score, total, streak, quizzesDone, sharedCount, isDaily }) {
  if (!user) return [];
  const uid = user.uid;
  const unlocked = [];
  const check = async (id) => {
    const got = await unlockAchievement(uid, id);
    if (got) unlocked.push(ACHIEVEMENTS.find(a => a.id === id));
  };
  if (quizzesDone >= 1) await check("first_quiz");
  if (score === total && total > 0) await check("perfect_score");
  if (streak >= 5) await check("streak_5");
  if (sharedCount >= 1) await check("shared_1");
  if (sharedCount >= 10) await check("shared_10");
  if (quizzesDone >= 10) await check("plays_10");
  if (quizzesDone >= 50) await check("plays_50");
  if (isDaily) await check("daily_1");
  return unlocked.filter(Boolean);
}

// ─── COMMENTS ─────────────────────────────────────────────────────────────────
export async function getComments(quizId) {
  const data = await fbGet(`/comments/${quizId}`);
  if (!data) return [];
  return Object.entries(data).map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function addComment(quizId, user, text) {
  if (!user || !text.trim()) return;
  await fbPush(`/comments/${quizId}`, {
    uid: user.uid,
    name: user.displayName || user.email?.split("@")[0] || "Anonymous",
    avatar: user.photoURL || null,
    text: text.trim(),
    createdAt: Date.now(),
  });
  await fbUpdate(`/shared_quizzes/${quizId}`, {
    commentCount: (await fbGet(`/shared_quizzes/${quizId}/commentCount`) || 0) + 1
  });
}

export async function deleteComment(quizId, commentId) {
  await fbDelete(`/comments/${quizId}/${commentId}`);
}
