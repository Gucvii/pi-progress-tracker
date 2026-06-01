/**
 * Progress Tracker Extension
 *
 * Enforces:
 *   1. Model must call update_progress BEFORE making any changes (declare intent).
 *   2. Model must call update_progress at least every N turns thereafter.
 *   3. If overdue, all other tool calls are BLOCKED until update_progress is called.
 *
 * Provides:
 *   - /progress  show the full progress timeline for this session
 *
 * Install:
 *   pi install git:github.com:Gucvii/pi-progress-tracker.git
 *
 * Configure (optional, via settings.json):
 *   {
 *     "progressTracker": {
 *       "maxTurns": 3,
 *       "language": "en"
 *     }
 *   }
 *
 * Or override by editing the config constant in this file directly.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

export interface ProgressTrackerConfig {
  /** Max turns allowed without an update_progress call before tools get blocked */
  maxTurns: number;
  /** Display language for UI labels ("en", "zh", "ja") */
  language: "en" | "zh" | "ja";
  /** Custom tool name (default: "update_progress") */
  toolName: string;
  /** Custom command name (default: "progress") */
  commandName: string;
}

type LangPack = {
  widget: { progress: string; reason: string };
  timeline: { progress: string; intent: string; reason: string; total: string; showAll: string };
  command: { noRecords: string; totalRecords: string };
  system: { declareIntent: string; previousProgress: string };
  block: {
    mustCallFirst: string;
    turnsOverdue: string;
  };
};

const LANG: Record<NonNullable<ProgressTrackerConfig["language"]>, LangPack> = {
  en: {
    widget: { progress: "Progress", reason: "Why" },
    timeline: {
      progress: "Progress",
      intent: "Intent",
      reason: "Reason",
      total: "total entries",
      showAll: "use /progress to view all",
    },
    command: { noRecords: "No progress records yet", totalRecords: "total progress records" },
    system: {
      declareIntent: "[Declare intent with update_progress before making changes. Batch update_progress with your other tool calls in the same turn.]",
      previousProgress: "[Previous progress: {status}] {intent} \u2014 {reason}",
    },
    block: {
      mustCallFirst: "You must call update_progress first to declare your intent and reason before making any changes.",
      turnsOverdue: "{n} turns since last update_progress. Call update_progress now before continuing.",
    },
  },
  zh: {
    widget: { progress: "进度", reason: "原因" },
    timeline: {
      progress: "进度", intent: "准备", reason: "原因",
      total: "共 {n} 条", showAll: "/progress 查看全部",
    },
    command: { noRecords: "暂无进度记录", totalRecords: "共 {n} 条进度记录" },
    system: {
      declareIntent: "[在做出更改前，先调用 update_progress 声明意图和原因。请将 update_progress 与其他工具调用放在同一轮中。]",
      previousProgress: "[上一进度: {status}] {intent} \u2014 {reason}",
    },
    block: {
      mustCallFirst: "必须先调用 update_progress 声明意图和原因，然后才能进行更改。",
      turnsOverdue: "距上次 update_progress 已过 {n} 轮。请立即调用 update_progress。",
    },
  },
  ja: {
    widget: { progress: "進捗", reason: "理由" },
    timeline: {
      progress: "進捗", intent: "意図", reason: "理由",
      total: "全 {n} 件", showAll: "/progress で全て表示",
    },
    command: { noRecords: "進捗記録がありません", totalRecords: "全 {n} 件の進捗記録" },
    system: {
      declareIntent: "[変更前は update_progress で意図と理由を宣言してください。update_progress を他のツール呼び出しと同じバッチで実行してください。]",
      previousProgress: "[前回の進捗: {status}] {intent} \u2014 {reason}",
    },
    block: {
      mustCallFirst: "変更を行う前に update_progress を呼び出して意図と理由を宣言する必要があります。",
      turnsOverdue: "前回の update_progress から {n} ターン経過しました。すぐに update_progress を呼び出してください。",
    },
  },
};

const STATUS_LABEL: Record<string, string> = {
  completed: "[done]",
  blocked: "[blocked]",
};

const CUSTOM_TYPE = "progress-tracker";

const DEFAULT_CONFIG: ProgressTrackerConfig = {
  maxTurns: 3,
  language: "en",
  toolName: "update_progress",
  commandName: "progress",
};

function mergeConfig(override?: Partial<ProgressTrackerConfig>): ProgressTrackerConfig {
  return { ...DEFAULT_CONFIG, ...override };
}

export default function (pi: ExtensionAPI) {
  // Read config from global settings or use defaults
  const cfg = DEFAULT_CONFIG;
  const lang = LANG[cfg.language];

  let turnsSinceLastUpdate = 0;
  let hasDeclaredIntent = false;
  let updateInCurrentBatch = false;
  let state: {
    intent: string;
    reason: string;
    status: string;
    situation?: string;
    progressNote?: string;
    timestamp: number;
  } | undefined;

  // ── Helpers ────────────────────────────────────────────────────

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function getProgressEntries(ctx: any): any[] {
    const branch = ctx.sessionManager.getBranch();
    return branch.filter((e: any) => e.type === "custom" && e.customType === CUSTOM_TYPE && e.data);
  }

  function statusLabel(status: string): string {
    return STATUS_LABEL[status] ?? "";
  }

  function buildTimeline(entries: any[], full: boolean): string[] {
    if (entries.length === 0) return [];
    const start = full ? 0 : Math.max(0, entries.length - 3);
    const display = entries.slice(start);
    const lines: string[] = [
      `\u2500\u2500 ${lang.timeline.progress} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
    ];
    for (let i = 0; i < display.length; i++) {
      const d = display[i].data;
      const time = formatTime(d.timestamp);
      const label = statusLabel(d.status);
      const labelSpace = label ? label + " " : "";
      lines.push(
        `${time} \u2192 ${labelSpace}${lang.timeline.intent}: ${d.intent}`,
      );
      if (d.reason) lines.push(`     ${lang.timeline.reason}: ${d.reason}`);
      if (i < display.length - 1) lines.push("");
    }
    if (!full && entries.length > 3) {
      lines.push(`  ... ${entries.length} ${lang.timeline.total}, ${lang.timeline.showAll}`);
    }
    lines.push(`\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    return lines;
  }

  function makeWidget(lines: string[], theme: any): Container {
    const container = new Container();
    for (const line of lines) {
      container.addChild(new Text(theme.fg("dim", line), 1, 0));
    }
    return container;
  }

  function updateUI(ctx: any) {
    const entries = getProgressEntries(ctx);
    if (entries.length === 0 || !state) {
      ctx.ui.setWidget("progress", []);
      return;
    }
    const latest = entries[entries.length - 1];
    if (!latest) return;
    const d = latest.data;
    const label = statusLabel(d.status);
    const labelSpace = label ? label + " " : "";
    ctx.ui.setWidget(
      "progress",
      (_, theme) =>
        makeWidget(
          [
            `\u2192 ${labelSpace}${lang.widget.progress}: ${d.intent}`,
            `  ${lang.widget.reason}: ${d.reason || ""}`,
          ],
          theme,
        ),
      { placement: "belowEditor" as const },
    );
  }

  // ── Register tool ──────────────────────────────────────────────

  pi.registerTool({
    name: cfg.toolName,
    label: "Update Progress",
    description:
      "Declare what you are about to do and why (intent + reason), then periodically update progress.",
    promptSnippet: "Declare your intent and reason at the start of each task",
    promptGuidelines: [
      "CRITICAL: When you call other tools, also include update_progress in the same batch. Do not use a separate turn just for progress.",
      `Call update_progress at least every ${cfg.maxTurns} turns to report progress. The turn counter is injected before each LLM call.`,
      "Use status 'in_progress' for ongoing work, 'completed' for finished items, 'blocked' for blockers.",
    ],
    parameters: Type.Object({
      intent: Type.String({
        description:
          "The specific action I am about to take. What I will do next. e.g. 'Search GitHub for relevant issues', 'Analyze the API docs'. Not a repeat of situation.",
      }),
      reason: Type.String({
        description:
          "Why I am doing this action. The rationale, e.g. 'Need to verify cross-platform support before making a recommendation'.",
      }),
      status: Type.Enum({ in_progress: "in_progress", completed: "completed", blocked: "blocked" }),
      situation: Type.Optional(
        Type.String({
          description:
            "The current state or what was just discovered/found. This is NOT the action. e.g. 'Found 3 projects: A, B, C', 'Search returned no results'. Different from intent.",
        }),
      ),
      progress_note: Type.Optional(
        Type.String({ description: "Brief progress note or blocker detail (optional)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      hasDeclaredIntent = true;
      updateInCurrentBatch = true;
      turnsSinceLastUpdate = 0;

      state = {
        intent: params.intent,
        reason: params.reason,
        status: params.status,
        situation: params.situation,
        progressNote: params.progress_note,
        timestamp: Date.now(),
      };

      pi.appendEntry(CUSTOM_TYPE, state);
      updateUI(ctx);

      return {
        content: [{ type: "text", text: `Progress updated: ${params.intent}` }],
        details: { intent: params.intent, reason: params.reason, status: params.status },
      };
    },
  });

  // ── /progress command ──────────────────────────────────────────

  pi.registerCommand(cfg.commandName, {
    description: "Show the full progress update timeline for this session",
    handler: async (_args, ctx) => {
      const entries = getProgressEntries(ctx);
      if (entries.length === 0) {
        ctx.ui.notify(lang.command.noRecords, "info");
        return;
      }
      ctx.ui.setWidget("progress", (_, theme) => makeWidget(buildTimeline(entries, true), theme));
      ctx.ui.notify(
        `${entries.length} ${lang.command.totalRecords}. Send a new message to clear.`,
        "info",
      );
    },
  });

  // ── before_agent_start: inject reminders ───────────────────────

  pi.on("before_agent_start", (event) => {
    let extra = "";
    extra += `\n\n[${lang.system.declareIntent}]`;
    if (state) {
      extra += `\n[${lang.system.previousProgress.replace("{status}", state.status).replace("{intent}", state.intent).replace("{reason}", state.reason)}]`;
    }
    if (!extra) return;
    return { systemPrompt: event.systemPrompt + extra };
  });

  pi.on("agent_start", (_event, ctx) => {
    hasDeclaredIntent = false;
    turnsSinceLastUpdate = 0;
    updateInCurrentBatch = false;
    ctx.ui.setWidget("progress", []);
  });

  pi.on("agent_end", () => {
    updateInCurrentBatch = false;
  });

  pi.on("turn_start", () => {
    updateInCurrentBatch = false;
  });

  // ── context: inject turn count before each LLM call ────────────

  pi.on("context", async (event) => {
    if (turnsSinceLastUpdate >= cfg.maxTurns - 1) {
      event.messages.push({
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `[System: ${turnsSinceLastUpdate}/${cfg.maxTurns} turns since last ${cfg.toolName}. Call ${cfg.toolName} alongside your next tool calls.]`,
          },
        ],
        timestamp: Date.now(),
      });
    }
  });

  // ── tool_call: ENFORCE by blocking ─────────────────────────────

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === cfg.toolName) {
      updateInCurrentBatch = true;
      return;
    }
    if (!hasDeclaredIntent) {
      return { block: true, reason: lang.block.mustCallFirst };
    }
    if (updateInCurrentBatch) return;
    if (turnsSinceLastUpdate >= cfg.maxTurns) {
      return {
        block: true,
        reason: lang.block.turnsOverdue.replace("{n}", String(turnsSinceLastUpdate)),
      };
    }
  });

  pi.on("tool_result", (event) => {
    if (event.toolName === cfg.toolName) {
      turnsSinceLastUpdate = 0;
    }
  });

  pi.on("turn_end", () => {
    if (!updateInCurrentBatch) {
      turnsSinceLastUpdate++;
    }
    updateInCurrentBatch = false;
  });

  // ── session lifecycle ─────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    hasDeclaredIntent = false;
    turnsSinceLastUpdate = 0;
    updateInCurrentBatch = false;
    state = undefined;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === CUSTOM_TYPE && (entry as any).data) {
        state = (entry as any).data;
      }
    }
    updateUI(ctx);
  });

  pi.on("session_shutdown", () => {
    hasDeclaredIntent = false;
    turnsSinceLastUpdate = 0;
    updateInCurrentBatch = false;
  });
}
