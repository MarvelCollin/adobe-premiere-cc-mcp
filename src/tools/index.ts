import { audioTools } from "./audio.js";
import { colorTools } from "./color.js";
import { connectionTools } from "./connection.js";
import { editTools } from "./edit.js";
import { effectTools } from "./effects.js";
import { exportTools } from "./export.js";
import { keyframeTools } from "./keyframes.js";
import { markerTools } from "./markers.js";
import { mediaTools } from "./media.js";
import { playheadTools } from "./playhead.js";
import { projectTools } from "./project.js";
import { stabilizerTools } from "./stabilizer.js";
import { timelineTools } from "./timeline.js";
import { trackTools } from "./tracks.js";
import { transformTools } from "./transform.js";
import { transitionTools } from "./transitions.js";
import type { ToolDefinition } from "./types.js";

/** Every tool the server exposes, grouped by the concern it covers. */
export const allTools: ToolDefinition[] = [
  ...connectionTools,
  ...timelineTools,
  ...playheadTools,
  ...trackTools,
  ...markerTools,
  ...mediaTools,
  ...editTools,
  ...transformTools,
  ...colorTools,
  ...audioTools,
  ...keyframeTools,
  ...effectTools,
  ...transitionTools,
  ...stabilizerTools,
  ...exportTools,
  ...projectTools,
];

export type { ToolDefinition } from "./types.js";
