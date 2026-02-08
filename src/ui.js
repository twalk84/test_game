export function setScore(score) {
  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = String(score);
}

export function setStatus(message) {
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = message;
}

let lastInteractionHint = null;

export function pushStatusFeed(message, tone = "info") {
  const feed = document.getElementById("statusFeed");
  if (!feed) return;
  const row = document.createElement("div");
  row.className = `status-feed-item ${tone}`;
  row.textContent = message;
  feed.prepend(row);
  while (feed.children.length > 5) {
    feed.removeChild(feed.lastElementChild);
  }
}

export function setDamageOverlay(intensity = 0) {
  const overlay = document.getElementById("damageOverlay");
  if (!overlay) return;
  const clamped = Math.max(0, Math.min(1, Number(intensity) || 0));
  overlay.style.opacity = clamped.toFixed(3);
}

export function setBlackoutOverlay(intensity = 0) {
  const overlay = document.getElementById("blackoutOverlay");
  if (!overlay) return;
  const clamped = Math.max(0, Math.min(1, Number(intensity) || 0));
  overlay.style.opacity = clamped.toFixed(3);
}

export function setSniperScopeActive(active) {
  document.body.classList.toggle("sniper-scope", Boolean(active));
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

export function setInventorySummary(text) {
  const inventoryEl = document.getElementById("inventorySummary");
  if (inventoryEl) inventoryEl.textContent = text;
}

export function setInventoryPanelVisible(visible) {
  const panel = document.getElementById("inventoryPanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !visible);
}

export function setCombatStatus(text) {
  const combatEl = document.getElementById("combatStatus");
  if (combatEl) combatEl.textContent = text;
}

export function setVehicleStatus(text) {
  const vehicleEl = document.getElementById("vehicleStatus");
  if (vehicleEl) vehicleEl.textContent = text;
}

export function setVehicleHealth(current = 0, max = 0, visible = false) {
  const row = document.getElementById("vehicleHealthRow");
  const wrap = document.getElementById("vehicleHealthBarWrap");
  const text = document.getElementById("vehicleHealthText");
  const bar = document.getElementById("vehicleHealthBar");

  const show = Boolean(visible) && Number(max) > 0;
  if (row) row.classList.toggle("hidden", !show);
  if (wrap) wrap.classList.toggle("hidden", !show);

  const safeMax = Math.max(1, Number(max) || 1);
  const safeCurrent = Math.max(0, Math.min(safeMax, Number(current) || 0));
  const pct = safeCurrent / safeMax;

  if (text) text.textContent = `${Math.round(safeCurrent)} / ${Math.round(safeMax)}`;
  if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
}

export function setWeaponStatus(text) {
  const weaponEl = document.getElementById("weaponStatus");
  if (weaponEl) weaponEl.textContent = text;
}

export function setWeaponHeat(current, max = 1) {
  const text = document.getElementById("weaponHeatText");
  const bar = document.getElementById("weaponHeatBar");
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  if (text) text.textContent = `${Math.round(pct * 100)}%`;
  if (bar) bar.style.width = `${pct * 100}%`;
}

export function setCrosshairSpread(pixels = 0, aiming = false) {
  const crosshair = document.getElementById("crosshair");
  if (!crosshair) return;
  const spread = Math.max(0, Math.min(24, Number(pixels) || 0));
  crosshair.style.setProperty("--spread", `${spread.toFixed(2)}px`);
  crosshair.classList.toggle("aiming", Boolean(aiming));
}

export function setPauseMenuVisible(visible) {
  const menu = document.getElementById("pauseMenu");
  if (!menu) return;
  menu.classList.toggle("hidden", !visible);
}

export function setControlsPanelVisible(visible) {
  const panel = document.getElementById("controlsPanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !visible);
}

export function setDebugOverlayVisible(visible) {
  const panel = document.getElementById("debugPanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !visible);
}

export function setDebugText(text) {
  const content = document.getElementById("debugText");
  if (!content) return;
  content.textContent = text;
}

export function setInteractionHint(text = "") {
  const hint = document.getElementById("interactionHint");
  if (!hint) return;
  if (text === lastInteractionHint) return;
  lastInteractionHint = text;
  hint.textContent = text;
}

export function setEffectsStatus(text = "None") {
  const effects = document.getElementById("effectsStatus");
  if (!effects) return;
  effects.textContent = text;
}
