# pi-progress-tracker

> Intent declaration and progress tracking for [Pi](https://pi.dev) coding agent.

Registers a custom tool (`update_progress`) and enforces that the model:
1. Calls `update_progress` to declare intent **before** making any changes
2. Repeats it at least every N turns
3. If overdue, all other tool calls are **blocked** until `update_progress` is called

Also provides a `/progress` command to review the full timeline.

## Installation

```bash
pi install git:github.com/Gucvii/pi-progress-tracker.git
```

Or via npm (once published):

```bash
pi install npm:pi-progress-tracker
```

## What it does

The `update_progress` tool has these parameters:

| Parameter      | Required | Description |
|----------------|----------|-------------|
| `intent`       | yes      | What you are about to do next |
| `reason`       | yes      | Why you are doing it |
| `status`       | yes      | `in_progress`, `completed`, or `blocked` |
| `situation`    | no       | Current state of affairs (what was just discovered) |
| `progress_note`| no       | Brief note or blocker detail |

<img width="1100" height="232" alt="截屏2026-06-01 11 08 43" src="https://github.com/user-attachments/assets/b00dcfc3-6e5e-47dd-a61f-e52e17e03c0d" />

### Enforcement rules

- **First call required** before any other tool can execute
- **Periodic calls required** every N turns (default: 3)
- **Batch with other tools**: the tool guidelines tell the model to call `update_progress` alongside other tools, not as a separate turn

### Commands

- `/progress` — display the full progress timeline for the current session

### Widget

A compact widget appears below the editor showing the latest progress entry.

## How it works

This extension:

1. **Registers `update_progress` tool** — the model calls it to log intent, reason, and status
2. **Persists progress to session** — uses `pi.appendEntry()` so progress survives restarts and `/tree` navigation
3. **Enforces via `tool_call` event** — blocks tools that haven't declared intent or are overdue
4. **Reminds via `context` event** — injects a system message when approaching the turn limit
5. **Displays widget** — shows current progress below the editor via `ctx.ui.setWidget()`
6. **Provides timeline** — `/progress` command shows all entries

## Configuration

Edit `DEFAULT_CONFIG` at the top of `extensions/index.ts`:

```typescript
const DEFAULT_CONFIG: ProgressTrackerConfig = {
  maxTurns: 3,       // turns before enforcement kicks in
  language: "en",    // "en" | "zh" | "ja"
  toolName: "update_progress",
  commandName: "progress",
};
```

Planned: reading config from `settings.json` via a `progressTracker` key.

## Requirements

- Pi coding agent (tested with recent versions)
- TypeScript / jiti runtime (comes with pi)

## Development

```bash
git clone https://github.com/Gucvii/pi-progress-tracker.git
cd pi-progress-tracker
# Test locally
pi -e ./extensions/index.ts
```

## License

MIT
