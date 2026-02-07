import { events } from "./events.js";

const QUEST_TYPES = [
  {
    id: "collection",
    label: "Collection",
    template: (tier) => ({
      description: `Collect ${3 + tier} crystals`,
      target: 3 + tier,
      trackEvent: "item-collected",
      trackField: "count",
    }),
  },
  {
    id: "hunt",
    label: "Hunt",
    template: (tier) => ({
      description: `Defeat ${2 + Math.floor(tier * 0.8)} enemies`,
      target: 2 + Math.floor(tier * 0.8),
      trackEvent: "enemy-killed",
      trackField: null, // each event = 1
    }),
  },
  {
    id: "survival",
    label: "Survival",
    template: (tier) => ({
      description: `Survive for ${20 + tier * 5} seconds`,
      target: 20 + tier * 5,
      trackEvent: null, // time-based
      isTimeBased: true,
    }),
  },
  {
    id: "exploration",
    label: "Exploration",
    template: (tier) => ({
      description: `Travel ${60 + tier * 20} meters`,
      target: 60 + tier * 20,
      trackEvent: null,
      isDistance: true,
    }),
  },
  {
    id: "defense",
    label: "Defense",
    template: (tier) => ({
      description: `Take no damage for ${10 + tier * 3} seconds`,
      target: 10 + tier * 3,
      trackEvent: null,
      isNoDamage: true,
    }),
  },
  {
    id: "speedrun",
    label: "Speed Run",
    template: (tier) => ({
      description: `Collect ${2 + Math.floor(tier * 0.6)} crystals in ${Math.max(12, 25 - tier * 2)} seconds`,
      target: 2 + Math.floor(tier * 0.6),
      timeLimit: Math.max(12, 25 - tier * 2),
      trackEvent: "item-collected",
      trackField: "count",
      isTimed: true,
    }),
  },
];

export class QuestSystem {
  constructor() {
    this.activeQuest = null;
    this.tier = 1;
    this.completedCount = 0;
    this._listeners = [];
  }

  generate(tier) {
    this.tier = tier;
    const type = QUEST_TYPES[Math.floor(Math.random() * QUEST_TYPES.length)];
    const config = type.template(tier);

    this.activeQuest = {
      typeId: type.id,
      label: type.label,
      description: config.description,
      target: config.target,
      progress: 0,
      timeLimit: config.timeLimit || 0,
      timeElapsed: 0,
      trackEvent: config.trackEvent,
      trackField: config.trackField,
      isTimeBased: config.isTimeBased || false,
      isDistance: config.isDistance || false,
      isNoDamage: config.isNoDamage || false,
      isTimed: config.isTimed || false,
      completed: false,
      failed: false,
      lastPos: null,
      noDamageTimer: 0,
    };

    // Subscribe to relevant events
    this._cleanupListeners();
    if (config.trackEvent) {
      const handler = (data) => {
        if (!this.activeQuest || this.activeQuest.completed || this.activeQuest.failed) return;
        const amount = config.trackField ? (data[config.trackField] || 1) : 1;
        this.activeQuest.progress += amount;
      };
      events.on(config.trackEvent, handler);
      this._listeners.push({ event: config.trackEvent, handler });
    }

    if (config.isNoDamage) {
      const dmgHandler = () => {
        if (!this.activeQuest || this.activeQuest.completed) return;
        this.activeQuest.noDamageTimer = 0; // reset on damage
      };
      events.on("player-damaged", dmgHandler);
      this._listeners.push({ event: "player-damaged", handler: dmgHandler });
    }

    return this.activeQuest;
  }

  update(dt, playerPos) {
    if (!this.activeQuest || this.activeQuest.completed || this.activeQuest.failed) return null;

    const q = this.activeQuest;

    // Time-based quests
    if (q.isTimeBased) {
      q.progress += dt;
    }

    // Distance quests
    if (q.isDistance) {
      if (q.lastPos) {
        const dx = playerPos.x - q.lastPos.x;
        const dz = playerPos.z - q.lastPos.z;
        q.progress += Math.hypot(dx, dz);
      }
      q.lastPos = { x: playerPos.x, z: playerPos.z };
    }

    // No-damage quests
    if (q.isNoDamage) {
      q.noDamageTimer += dt;
      q.progress = q.noDamageTimer;
    }

    // Timed quests (speedrun)
    if (q.isTimed) {
      q.timeElapsed += dt;
      if (q.timeElapsed >= q.timeLimit && q.progress < q.target) {
        q.failed = true;
        this._cleanupListeners();
        return { type: "failed", quest: q };
      }
    }

    // Check completion
    if (q.progress >= q.target) {
      q.completed = true;
      this.completedCount++;
      this._cleanupListeners();

      const rewardScore = 10 + this.tier * 8;
      const rewardXp = 30 + this.tier * 20;
      return {
        type: "completed",
        quest: q,
        rewardScore,
        rewardXp,
      };
    }

    return null;
  }

  getDisplayText() {
    if (!this.activeQuest) return "No active quest";
    const q = this.activeQuest;
    if (q.completed) return `${q.label}: Complete!`;
    if (q.failed) return `${q.label}: Failed!`;

    let progressText;
    if (q.isTimeBased || q.isNoDamage) {
      progressText = `${Math.floor(q.progress)}s / ${q.target}s`;
    } else if (q.isDistance) {
      progressText = `${Math.floor(q.progress)}m / ${q.target}m`;
    } else {
      progressText = `${Math.floor(q.progress)} / ${q.target}`;
    }

    let timeText = "";
    if (q.isTimed) {
      const remaining = Math.max(0, q.timeLimit - q.timeElapsed);
      timeText = ` (${Math.ceil(remaining)}s left)`;
    }

    return `${q.label}: ${q.description} — ${progressText}${timeText}`;
  }

  _cleanupListeners() {
    for (const { event, handler } of this._listeners) {
      events.off(event, handler);
    }
    this._listeners = [];
  }

  getSaveState() {
    return {
      tier: this.tier,
      completedCount: this.completedCount,
    };
  }

  applySaveState(data) {
    if (!data) return;
    this.tier = data.tier || 1;
    this.completedCount = data.completedCount || 0;
  }
}
