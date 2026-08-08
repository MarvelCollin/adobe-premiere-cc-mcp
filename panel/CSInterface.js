function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  if (typeof callback !== "function") {
    callback = function () {};
  }
  window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getHostEnvironment = function () {
  return JSON.parse(window.__adobe_cep__.getHostEnvironment());
};

CSInterface.prototype.getSystemPath = function (type) {
  var path = decodeURI(window.__adobe_cep__.getSystemPath(type));
  return path.replace(/^file:\/{2,3}/, "");
};

CSInterface.prototype.getExtensionID = function () {
  return window.__adobe_cep__.getExtensionId();
};
