export function setScore(score) {
  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = String(score);
}

export function setStatus(message) {
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = message;
}

export function setHealth(current, max) {
  const text = document.getElementById("healthText");
  const bar = document.getElementById("healthBar");
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  if (text) text.textContent = `${Math.round(current)} / ${Math.round(max)}`;
  if (bar) bar.style.width = `${pct * 100}%`;
}

export function setStamina(current, max) {
  const text = document.getElementById("staminaText");
  const bar = document.getElementById("staminaBar");
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  if (text) text.textContent = `${Math.round(current)} / ${Math.round(max)}`;
  if (bar) bar.style.width = `${pct * 100}%`;
}

export function setProgression({ level, xp, points }) {
  const levelEl = document.getElementById("level");
  const xpEl = document.getElementById("xp");
  const pointsEl = document.getElementById("points");
  if (levelEl) levelEl.textContent = String(level);
  if (xpEl) xpEl.textContent = String(Math.floor(xp));
  if (pointsEl) pointsEl.textContent = String(points);
}

export function setObjective(text) {
  const objectiveEl = document.getElementById("objective");
  if (objectiveEl) objectiveEl.textContent = text;
}

export function setCombatStatus(text) {
  const combatEl = document.getElementById("combatStatus");
  if (combatEl) combatEl.textContent = text;
}

export function setWeaponStatus(text) {
  const weaponEl = document.getElementById("weaponStatus");
  if (weaponEl) weaponEl.textContent = text;
}

export function setAbilityStatus(cooldowns) {
  const el = document.getElementById("abilityStatus");
  if (!el) return;
  const parts = [];
  for (const [, info] of Object.entries(cooldowns)) {
    if (info.ready) {
      parts.push(`${info.label}:RDY`);
    } else {
      parts.push(`${info.label}:${info.remaining.toFixed(1)}s`);
    }
  }
  el.textContent = parts.join(" | ");
}

export function setBuffStatus(text) {
  const el = document.getElementById("buffStatus");
  if (el) el.textContent = text;
}

export function showDeathScreen(stats) {
  const el = document.getElementById("deathScreen");
  if (!el) return;
  const statsEl = document.getElementById("deathStats");
  if (statsEl) {
    statsEl.innerHTML =
      `<div>Kills: ${stats.kills}</div>` +
      `<div>Score: ${stats.score}</div>` +
      `<div>Level: ${stats.level}</div>` +
      `<div>Survival time: ${Math.floor(stats.survivalTime)}s</div>`;
  }
  el.classList.remove("hidden");
}

export function hideDeathScreen() {
  const el = document.getElementById("deathScreen");
  if (el) el.classList.add("hidden");
}

export function setPauseMenuVisible(visible) {
  const menu = document.getElementById("pauseMenu");
  if (!menu) return;
  menu.classList.toggle("hidden", !visible);
}
