const SAVE_KEY = "open_world_mvp_save_v2";
const LEGACY_SAVE_KEY = "open_world_mvp_save_v1";

export function saveGame(data) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
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
