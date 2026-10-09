// The leaderboard window: best score or total points, one row per name, as
// MRT Station Guesser's.

import { api } from "./api.js";
import { LEVELS } from "./quiz.js";
import { escapeHtml, openModal } from "./ui.js";

function describe(e) {
  const level = LEVELS[e.difficulty]?.name ?? "";
  return `${e.mode === "multi" ? "Multiplayer, " : ""}${level}, ${e.questions} Q`;
}

const BOARDS = {
  best: {
    head: ["#", "Name", "Score", "Game"],
    row: (e) => [e.rank, e.name, e.score, describe(e)],
    about: "Each name's single best game.",
  },
  total: {
    head: ["#", "Name", "Total", "Games"],
    row: (e) => [e.rank, e.name, e.total, e.games],
    about: "Every game added under a name, scores added up.",
  },
};

let board = "best";
let loading = 0;

function setTab(next) {
  board = next;
  document.querySelectorAll("#boardTabs [data-board]").forEach((el) => {
    const on = el.dataset.board === board;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", String(on));
  });
}

async function load() {
  const body = document.getElementById("boardBody");
  const note = document.getElementById("boardNote");
  const ticket = ++loading;
  const spec = BOARDS[board];
  body.setAttribute("aria-busy", "true");
  note.textContent = spec.about;

  try {
    const data = await api.leaderboard(board);
    if (ticket !== loading) return;
    const entries = data.entries ?? [];
    body.innerHTML = entries.length
      ? `<table class="board-table">
          <thead><tr>${spec.head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>
          <tbody>${entries
            .map((e) => `<tr>${spec.row(e).map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`)
            .join("")}</tbody>
        </table>`
      : `<p class="board-empty">No scores yet. Finish a game and add yours.</p>`;
  } catch (err) {
    if (ticket !== loading) return;
    body.innerHTML = `<p class="board-empty">${
      err.code === "offline" ? "The leaderboard needs a connection." : "The leaderboard did not load. Try again in a moment."
    }</p>`;
  } finally {
    if (ticket === loading) body.removeAttribute("aria-busy");
  }
}

export function openLeaderboard(which = board) {
  setTab(which);
  openModal("boardModal");
  load();
}

export function initLeaderboard() {
  document.getElementById("boardBtn").addEventListener("click", () => openLeaderboard());
  document.getElementById("boardTabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-board]");
    if (!tab || tab.dataset.board === board) return;
    setTab(tab.dataset.board);
    load();
  });
}
