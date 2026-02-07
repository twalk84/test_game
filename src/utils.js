// Shared utility functions — single source, no duplication.

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
