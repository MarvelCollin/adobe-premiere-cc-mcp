import { analysisTools } from "./analysis.js";
import { assemblyTools } from "./assembly.js";
import { beatTools } from "./beats.js";
import { audioCheckTools } from "./audiocheck.js";
import { audioTools } from "./audio.js";
import { colorTools } from "./color.js";
import { connectionTools } from "./connection.js";
import { critiqueTools } from "./critique.js";
import { dialogueTools } from "./dialogue.js";
import { duckingTools } from "./ducking.js";
import { editTools } from "./edit.js";
import { effectTools } from "./effects.js";
import { exportTools } from "./export.js";
import { gradeReadTools } from "./grade-read.js";
import { keyframeTools } from "./keyframes.js";
import { linkTools } from "./links.js";
import { loudnessTools } from "./loudness.js";
import { markerTools } from "./markers.js";
import { mediaTools } from "./media.js";
import { motionTools } from "./motion.js";
import { overviewTools } from "./overview.js";
import { playheadTools } from "./playhead.js";
import { projectTools } from "./project.js";
import { qcTools } from "./qc.js";
import { rangeTools } from "./range.js";
import { reviewTools } from "./review.js";
import { scopeTools } from "./scopes.js";
import { splitEditTools } from "./splitedit.js";
import { sequenceTools } from "./sequence.js";
import { stabilizerTools } from "./stabilizer.js";
import { timelineTools } from "./timeline.js";
import { trackTools } from "./tracks.js";
import { transformTools } from "./transform.js";
import { transitionTools } from "./transitions.js";
import type { ToolDefinition } from "./types.js";

export const allTools: ToolDefinition[] = [
  ...connectionTools,
  ...timelineTools,
  ...sequenceTools,
  ...reviewTools,
  ...critiqueTools,
  ...overviewTools,
  ...analysisTools,
  ...scopeTools,
  ...playheadTools,
  ...rangeTools,
  ...trackTools,
  ...markerTools,
  ...beatTools,
  ...splitEditTools,
  ...motionTools,
  ...qcTools,
  ...audioCheckTools,
  ...duckingTools,
  ...dialogueTools,
  ...mediaTools,
  ...linkTools,
  ...editTools,
  ...assemblyTools,
  ...transformTools,
  ...colorTools,
  ...gradeReadTools,
  ...audioTools,
  ...loudnessTools,
  ...keyframeTools,
  ...effectTools,
  ...transitionTools,
  ...stabilizerTools,
  ...exportTools,
  ...projectTools,
];

export type { ToolDefinition } from "./types.js";
