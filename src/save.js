const SAVE_PREFIX = "open_world_mvp_slot_";
const LEGACY_KEYS = ["open_world_mvp_save_v3", "open_world_mvp_save_v2", "open_world_mvp_save_v1"];
const MAX_SLOTS = 3;
const SAVE_VERSION = 4;

function migrate(data) {
  if (!data || typeof data !== "object") return null;

  if (!data.version) data.version = 2;
  if (data.version === 2) data.version = 3;
  if (data.version === 3) data.version = 4;

  return data;
}

function slotKey(slot) {
  return SAVE_PREFIX + slot;
}

export function saveGame(data, slot = 0) {
  data.version = SAVE_VERSION;
  data.savedAt = Date.now();
  localStorage.setItem(slotKey(slot), JSON.stringify(data));
}

export function loadGame(slot = 0) {
  try {
    const raw = localStorage.getItem(slotKey(slot));
    if (raw) return migrate(JSON.parse(raw));

    // Try legacy keys (only for slot 0)
    if (slot === 0) {
      for (const key of LEGACY_KEYS) {
        const legacyRaw = localStorage.getItem(key);
        if (legacyRaw) {
          const data = migrate(JSON.parse(legacyRaw));
          if (data) saveGame(data, 0);
          return data;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function resetSave(slot = 0) {
  localStorage.removeItem(slotKey(slot));
  if (slot === 0) {
    for (const key of LEGACY_KEYS) {
      localStorage.removeItem(key);
    }
  }
}

export function getSlotInfo() {
  const slots = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    try {
      const raw = localStorage.getItem(slotKey(i));
      if (raw) {
        const data = JSON.parse(raw);
        slots.push({
          slot: i,
          exists: true,
          level: data.level || 1,
          score: data.score || 0,
          savedAt: data.savedAt || 0,
          playtime: data.playtime || 0,
        });
      } else {
        slots.push({ slot: i, exists: false });
      }
    } catch {
      slots.push({ slot: i, exists: false });
    }
  }
  return slots;
}

export function exportSave(slot = 0) {
  const raw = localStorage.getItem(slotKey(slot));
  if (!raw) return null;
  return btoa(raw);
}

export function importSave(base64String, slot = 0) {
  try {
    const raw = atob(base64String);
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return false;
    localStorage.setItem(slotKey(slot), raw);
    return true;
  } catch {
    return false;
  }
}
