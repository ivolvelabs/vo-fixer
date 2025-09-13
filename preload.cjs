const { contextBridge, ipcRenderer } = require("electron");
const { pathToFileURL } = require("node:url");

contextBridge.exposeInMainWorld("vofix", {
  pickInput: () => ipcRenderer.invoke("pick-input"),
  getDefaultOutput: (inputPath) =>
    ipcRenderer.invoke("get-default-output", inputPath),
  processAudio: (payload) => ipcRenderer.invoke("process-audio", payload),
  processPreview: (payload) => ipcRenderer.invoke("process-preview", payload),
  onLog: (cb) => ipcRenderer.on("ffmpeg-log", (_evt, msg) => cb(msg)),
  toFileUrl: (fsPath) => pathToFileURL(fsPath).toString(),
});
