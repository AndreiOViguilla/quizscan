import { LB_KEY, HIST_KEY } from "./constants";

export function loadLB() {
  try { return JSON.parse(localStorage.getItem(LB_KEY) || "[]"); } catch { return []; }
}
export function saveLB(entry) {
  const lb = loadLB();
  lb.push(entry);
  lb.sort((a, b) => b.pct - a.pct || a.time - b.time);
  localStorage.setItem(LB_KEY, JSON.stringify(lb.slice(0, 20)));
}
export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; }
}
export function saveHistory(entry) {
  const h = loadHistory();
  h.unshift(entry);
  localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 20)));
}
export function clearLB() { localStorage.removeItem(LB_KEY); }
export function clearHistory() { localStorage.removeItem(HIST_KEY); }
