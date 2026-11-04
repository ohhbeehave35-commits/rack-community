const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("talkback", {
  choose: (choice) => ipcRenderer.invoke("talkback:choose", choice),
});
