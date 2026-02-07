const SAVE_KEY = "open_world_mvp_save_v3";
const LEGACY_KEYS = ["open_world_mvp_save_v2", "open_world_mvp_save_v1"];

function migrate(data) {
  if (!data || typeof data !== "object") return null;

  // v1/v2 saves have no version field — treat as v2
  if (!data.version) {
    data.version = 2;
  }

  // Migrate v2 → v3: add version field (already set above)
  if (data.version === 2) {
    data.version = 3;
  }

  return data;
}

export function saveGame(data) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return migrate(JSON.parse(raw));

    // Try legacy keys in order
    for (const key of LEGACY_KEYS) {
      const legacyRaw = localStorage.getItem(key);
      if (legacyRaw) {
        const data = migrate(JSON.parse(legacyRaw));
        // Re-save under new key so future loads are faster
        if (data) saveGame(data);
        return data;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function resetSave() {
  localStorage.removeItem(SAVE_KEY);
  for (const key of LEGACY_KEYS) {
    localStorage.removeItem(key);
  }
}
