(function () {
  "use strict";

  var POLL_MS = 150;
  var BUSY_AFTER_MS = 2000;
  var BUSY_TICK_MS = 1000;
  var MAX_LOG_ROWS = 60;

  var cs = new CSInterface();
  var fs = require("fs");
  var path = require("path");
  var os = require("os");

  var bridgeDir = path.join(os.tmpdir(), "premiere-mcp-bridge");
  var engineId = Math.random().toString(36).slice(2, 8);
  var running = false;
  var timer = null;
  var handled = 0;
  var failed = 0;

  var statusEl = document.getElementById("status");
  var dirEl = document.getElementById("dir");
  var countsEl = document.getElementById("counts");
  var logEl = document.getElementById("log");
  var toggleEl = document.getElementById("toggle");

  function log(message, kind) {
    var row = document.createElement("div");
    row.className = "row " + (kind || "info");
    var time = new Date().toTimeString().slice(0, 8);
    row.textContent = time + "  " + message;
    logEl.insertBefore(row, logEl.firstChild);
    while (logEl.childNodes.length > MAX_LOG_ROWS) {
      logEl.removeChild(logEl.lastChild);
    }
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status " + kind;
  }

  function updateCounts() {
    countsEl.textContent = handled + " handled, " + failed + " failed";
  }

  function ensureDir() {
    try {
      if (!fs.existsSync(bridgeDir)) fs.mkdirSync(bridgeDir, { recursive: true });
      return true;
    } catch (error) {
      log("Cannot create " + bridgeDir + ": " + error.message, "err");
      return false;
    }
  }

  function commandFiles() {
    try {
      return fs
        .readdirSync(bridgeDir)
        .filter(function (name) {
          return name.indexOf("cmd_") === 0 && name.slice(-4) === ".jsx";
        })
        .sort();
    } catch (error) {
      return [];
    }
  }

  function writeFile(target, content) {
    try {
      fs.writeFileSync(target, content, "utf-8");
      return true;
    } catch (error) {
      log("Write failed for " + target + ": " + error.message, "err");
      return false;
    }
  }

  function removeFile(target) {
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch (error) {
      return;
    }
  }

  function runCommand(fileName) {
    var commandPath = path.join(bridgeDir, fileName);
    var claimPath = commandPath + "." + engineId + ".claim";

    try {
      fs.renameSync(commandPath, claimPath);
    } catch (error) {
      return;
    }

    var script;
    try {
      script = fs.readFileSync(claimPath, "utf-8");
    } catch (error) {
      log("Unreadable command " + fileName, "err");
      removeFile(claimPath);
      return;
    }
    removeFile(claimPath);

    var id = fileName.replace("cmd_", "").replace(".jsx", "");
    var responsePath = path.join(bridgeDir, "res_" + id + ".json");
    var busyPath = path.join(bridgeDir, "busy_" + id + ".json");
    var startedAt = Date.now();

    var busyTimer = setInterval(function () {
      if (Date.now() - startedAt < BUSY_AFTER_MS) return;
      writeFile(busyPath, '{"id":"' + id + '","elapsedMs":' + (Date.now() - startedAt) + "}");
    }, BUSY_TICK_MS);

    log("Running " + fileName + " (" + script.length + " chars)", "cmd");

    cs.evalScript(script, function (result) {
      clearInterval(busyTimer);
      removeFile(busyPath);

      var elapsed = Date.now() - startedAt;
      if (result === undefined || result === null || result === "" || result === "undefined") {
        failed++;
        writeFile(
          responsePath,
          '{"ok":false,"error":"The script returned nothing. It must end with __result(...) or __error(...)."}',
        );
        log("Empty result after " + elapsed + "ms", "err");
      } else {
        handled++;
        writeFile(responsePath, String(result));
        log("Replied in " + elapsed + "ms", "ok");
      }
      updateCounts();
    });
  }

  function tick() {
    var files = commandFiles();
    for (var i = 0; i < files.length; i++) runCommand(files[i]);
  }

  function start() {
    if (running) return;
    if (!ensureDir()) {
      setStatus("Cannot reach the bridge folder", "bad");
      return;
    }
    running = true;
    timer = setInterval(tick, POLL_MS);
    setStatus("Listening", "good");
    toggleEl.textContent = "Stop";
    log("Listening in " + bridgeDir, "info");
  }

  function stop() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    timer = null;
    setStatus("Stopped", "bad");
    toggleEl.textContent = "Start";
    log("Stopped", "info");
  }

  toggleEl.addEventListener("click", function () {
    if (running) stop();
    else start();
  });

  dirEl.textContent = bridgeDir;
  updateCounts();
  start();
})();
