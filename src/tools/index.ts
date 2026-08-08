import { audioTools } from "./audio.js";
import { colorTools } from "./color.js";
import { connectionTools } from "./connection.js";
import { effectTools } from "./effects.js";
import { exportTools } from "./export.js";
import { keyframeTools } from "./keyframes.js";
import { projectTools } from "./project.js";
import { stabilizerTools } from "./stabilizer.js";
import { timelineTools } from "./timeline.js";
import { transformTools } from "./transform.js";
import type { ToolDefinition } from "./types.js";

/** Every tool the server exposes, grouped by the concern it covers. */
export const allTools: ToolDefinition[] = [
  ...connectionTools,
  ...timelineTools,
  ...transformTools,
  ...colorTools,
  ...audioTools,
  ...keyframeTools,
  ...effectTools,
  ...stabilizerTools,
  ...exportTools,
  ...projectTools,
];

export type { ToolDefinition } from "./types.js";
