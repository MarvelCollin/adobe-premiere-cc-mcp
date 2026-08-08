export function esc(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

const HELPERS = String.raw`
var TICKS_PER_SECOND = 254016000000;

function __ticksToSeconds(ticks) { return Number(ticks) / TICKS_PER_SECOND; }
function __secondsToTicks(seconds) { return Math.round(Number(seconds) * TICKS_PER_SECOND); }

function __seq() { return app.project.activeSequence; }
function __qe() { app.enableQE(); return qe.project.getActiveSequence(); }

function __findClip(nodeId) {
  var seq = __seq();
  if (!seq) return null;
  var groups = [
    { list: seq.videoTracks, type: "video" },
    { list: seq.audioTracks, type: "audio" }
  ];
  for (var g = 0; g < groups.length; g++) {
    var tracks = groups[g].list;
    for (var t = 0; t < tracks.numTracks; t++) {
      var clips = tracks[t].clips;
      for (var c = 0; c < clips.numItems; c++) {
        if (String(clips[c].nodeId) === String(nodeId)) {
          return { clip: clips[c], trackIndex: t, clipIndex: c, trackType: groups[g].type };
        }
      }
    }
  }
  return null;
}

function __qeClipAt(qeTrack, startSeconds) {
  for (var i = 0; i < qeTrack.numItems; i++) {
    var item = qeTrack.getItemAt(i);
    if (!item || String(item.type) === "Empty") continue;
    if (Math.abs(__ticksToSeconds(item.start.ticks) - startSeconds) < 0.02) return item;
  }
  return null;
}

function __qeTrackFor(found) {
  var qeSeq = __qe();
  return found.trackType === "video"
    ? qeSeq.getVideoTrackAt(found.trackIndex)
    : qeSeq.getAudioTrackAt(found.trackIndex);
}

function __component(clip, displayName) {
  for (var i = 0; i < clip.components.numItems; i++) {
    if (String(clip.components[i].displayName) === displayName) return clip.components[i];
  }
  return null;
}

function __property(component, displayName) {
  for (var p = 0; p < component.properties.numItems; p++) {
    if (String(component.properties[p].displayName) === displayName) return component.properties[p];
  }
  return null;
}

function __componentNames(clip) {
  var names = [];
  for (var i = 0; i < clip.components.numItems; i++) names.push(String(clip.components[i].displayName));
  return names;
}

function __clearKeys(prop) {
  var varying = false;
  try { varying = prop.isTimeVarying(); } catch (e) { varying = false; }
  if (!varying) return 0;
  var keys = null;
  try { keys = prop.getKeys(); } catch (e2) { keys = null; }
  var removed = 0;
  if (keys && keys.length) {
    for (var k = keys.length - 1; k >= 0; k--) { prop.removeKey(keys[k]); removed++; }
  }
  prop.setTimeVarying(false, true);
  return removed;
}

function __escapeJson(s) {
  s = String(s);
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    var code = s.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 32) out += " ";
    else out += ch;
  }
  return out;
}

function __json(value) {
  if (value === null || value === undefined) return "null";
  var t = typeof value;
  if (t === "number") return isFinite(value) ? String(value) : "null";
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return '"' + __escapeJson(value) + '"';
  if (value instanceof Array) {
    var parts = [];
    for (var i = 0; i < value.length; i++) parts.push(__json(value[i]));
    return "[" + parts.join(",") + "]";
  }
  var fields = [];
  for (var key in value) {
    if (!value.hasOwnProperty(key)) continue;
    fields.push('"' + __escapeJson(key) + '":' + __json(value[key]));
  }
  return "{" + fields.join(",") + "}";
}

function __result(data) { return '{"ok":true,"data":' + __json(data) + "}"; }
function __error(message) { return '{"ok":false,"error":"' + __escapeJson(message) + '"}'; }
`;

export function wrapScript(body: string): string {
  return `(function () {
${HELPERS}
  try {
${body}
  } catch (err) {
    return __error("ExtendScript error: " + err.toString());
  }
})();`;
}
