const MISSION_TYPES = {
  COLLECT: "collect",
  ELIMINATE: "eliminate",
  SURVIVE: "survive",
};

const MISSION_TEMPLATES = [
  {
    id: "collect_crystals",
    title: "Crystal Sweep",
    type: MISSION_TYPES.COLLECT,
    baseTarget: 3,
    targetPerTier: 1,
    baseTime: 45,
    minTime: 24,
    timeStep: 2,
    baseScore: 12,
    scorePerTier: 5,
    baseXp: 40,
    xpPerTier: 14,
  },
  {
    id: "eliminate_hostiles",
    title: "Clear Hostiles",
    type: MISSION_TYPES.ELIMINATE,
    baseTarget: 2,
    targetPerTier: 1,
    baseTime: 42,
    minTime: 24,
    timeStep: 2,
    baseScore: 14,
    scorePerTier: 6,
    baseXp: 46,
    xpPerTier: 14,
  },
  {
    id: "survive_storm",
    title: "Hold the Line",
    type: MISSION_TYPES.SURVIVE,
    baseTarget: 1,
    targetPerTier: 0,
    baseTime: 26,
    minTime: 16,
    timeStep: 1,
    baseScore: 18,
    scorePerTier: 8,
    baseXp: 52,
    xpPerTier: 18,
  },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildMissionFromTemplate(template, tier) {
  return {
    templateId: template.id,
    title: template.title,
    type: template.type,
    tier,
    target: Math.max(1, template.baseTarget + (tier - 1) * template.targetPerTier),
    progress: 0,
    timeLimit: Math.max(template.minTime, template.baseTime - (tier - 1) * template.timeStep),
    timeLeft: Math.max(template.minTime, template.baseTime - (tier - 1) * template.timeStep),
    rewardScore: template.baseScore + tier * template.scorePerTier,
    rewardXp: template.baseXp + tier * template.xpPerTier,
  };
}

export class MissionSystem {
  constructor() {
    this.tier = 1;
    this.templateIndex = 0;
    this.activeMission = buildMissionFromTemplate(MISSION_TEMPLATES[0], this.tier);
  }

  getObjectiveText() {
    const m = this.activeMission;
    if (!m) return "No active mission";
    const timer = `${Math.ceil(m.timeLeft)}s`;

    if (m.type === MISSION_TYPES.SURVIVE) {
      return `${m.title}: Survive ${timer}`;
    }

    const action = m.type === MISSION_TYPES.COLLECT ? "Collect" : "Eliminate";
    const noun = m.type === MISSION_TYPES.COLLECT ? "crystals" : "enemies";
    return `${m.title}: ${action} ${m.target} ${noun} in ${timer} (${m.progress}/${m.target})`;
  }

  _advanceMission() {
    this.tier += 1;
    this.templateIndex = (this.templateIndex + 1) % MISSION_TEMPLATES.length;
    this.activeMission = buildMissionFromTemplate(MISSION_TEMPLATES[this.templateIndex], this.tier);
  }

  _restartCurrentMission() {
    const template = MISSION_TEMPLATES[this.templateIndex] || MISSION_TEMPLATES[0];
    this.activeMission = buildMissionFromTemplate(template, this.tier);
  }

  onEvent(eventName, payload = {}) {
    const m = this.activeMission;
    if (!m) return;

    if (m.type === MISSION_TYPES.COLLECT && eventName === "collectible_collected") {
      m.progress = clamp(m.progress + numberOr(payload.count, 1), 0, m.target);
    } else if (m.type === MISSION_TYPES.ELIMINATE && eventName === "enemy_killed") {
      m.progress = clamp(m.progress + numberOr(payload.count, 1), 0, m.target);
    }
  }

  update(dt) {
    const m = this.activeMission;
    if (!m) {
      return { state: "idle", objectiveText: "No active mission" };
    }

    m.timeLeft = Math.max(0, m.timeLeft - dt);

    if (m.type === MISSION_TYPES.SURVIVE) {
      if (m.timeLeft <= 0) {
        const reward = { score: m.rewardScore, xp: m.rewardXp };
        this._advanceMission();
        return {
          state: "completed",
          reward,
          objectiveText: this.getObjectiveText(),
          message: `Mission complete: ${m.title}! +${reward.score} score, +${reward.xp} XP`,
        };
      }
      return { state: "active", objectiveText: this.getObjectiveText() };
    }

    if (m.progress >= m.target) {
      const reward = { score: m.rewardScore, xp: m.rewardXp };
      this._advanceMission();
      return {
        state: "completed",
        reward,
        objectiveText: this.getObjectiveText(),
        message: `Mission complete: ${m.title}! +${reward.score} score, +${reward.xp} XP`,
      };
    }

    if (m.timeLeft <= 0) {
      const failedMissionName = m.title;
      this._restartCurrentMission();
      return {
        state: "failed",
        objectiveText: this.getObjectiveText(),
        message: `Mission failed: ${failedMissionName}. Restarting objective.`,
      };
    }

    return { state: "active", objectiveText: this.getObjectiveText() };
  }

  getSaveState() {
    return {
      tier: this.tier,
      templateIndex: this.templateIndex,
      activeMission: { ...this.activeMission },
    };
  }

  applySaveState(savedState) {
    if (!savedState) {
      this.tier = 1;
      this.templateIndex = 0;
      this.activeMission = buildMissionFromTemplate(MISSION_TEMPLATES[0], this.tier);
      return;
    }

    this.tier = Math.max(1, numberOr(savedState.tier, 1));
    this.templateIndex = clamp(numberOr(savedState.templateIndex, 0), 0, MISSION_TEMPLATES.length - 1);

    const template = MISSION_TEMPLATES[this.templateIndex] || MISSION_TEMPLATES[0];
    const fallback = buildMissionFromTemplate(template, this.tier);
    const savedMission = savedState.activeMission || {};

    this.activeMission = {
      ...fallback,
      title: typeof savedMission.title === "string" ? savedMission.title : fallback.title,
      type: typeof savedMission.type === "string" ? savedMission.type : fallback.type,
      target: Math.max(1, numberOr(savedMission.target, fallback.target)),
      progress: Math.max(0, numberOr(savedMission.progress, fallback.progress)),
      timeLimit: Math.max(1, numberOr(savedMission.timeLimit, fallback.timeLimit)),
      timeLeft: clamp(numberOr(savedMission.timeLeft, fallback.timeLeft), 0, Math.max(1, numberOr(savedMission.timeLimit, fallback.timeLimit))),
      rewardScore: Math.max(1, numberOr(savedMission.rewardScore, fallback.rewardScore)),
      rewardXp: Math.max(1, numberOr(savedMission.rewardXp, fallback.rewardXp)),
    };
  }
}