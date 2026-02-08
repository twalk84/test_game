import { GAME_CONFIG } from "./config.js";

const SAVE_KEY = "open_world_mvp_save_v2";
const LEGACY_SAVE_KEY = "open_world_mvp_save_v1";

export function saveGame(data) {
  const payload = {
    ...data,
    meta: {
      version: GAME_CONFIG.save.version,
      savedAt: Date.now(),
    },
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return JSON.parse(raw);

    const legacyRaw = localStorage.getItem(LEGACY_SAVE_KEY);
    if (!legacyRaw) return null;
    return JSON.parse(legacyRaw);
  } catch {
    return null;
  }
}

export function resetSave() {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(LEGACY_SAVE_KEY);
}
