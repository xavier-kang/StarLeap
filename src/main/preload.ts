import { contextBridge, ipcRenderer } from "electron";

const ALLOW_INVOKE = new Set([
  "auth:getUser",
  "auth:startQr",
  "auth:pollQr",
  "auth:loginPassword",
  "auth:logout",
  "auth:checkSession",
  "courses:list",
  "chapters:list",
  "chapter:cards",
  "chapter:enqueue",
  "queue:snapshot",
  "queue:start",
  "queue:pause",
  "queue:resumeAfterRisk",
  "queue:removeTask",
  "queue:retryTask",
  "queue:clearFinished",
  "sheets:list",
  "sheets:submit",
  "sheets:regen",
  "settings:get",
  "settings:set",
  "stats:get",
  "logs:recent",
  "assist:show",
  "assist:hide",
  "assist:navigate",
  "assist:back",
  "assist:layout",
  "assist:state",
  "debug:quizFetch",
  "debug:fetchHtml",
  "debug:postForm",
  "debug:http",
  "tiku:test",
  "app:info",
]);

contextBridge.exposeInMainWorld("starleap", {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOW_INVOKE.has(channel)) {
      return Promise.resolve({ ok: false, error: `未知通道: ${channel}` });
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, cb: (payload: unknown) => void) => {
    const allowed = ["queue-event", "auth-changed", "sheets-updated", "stats-updated", "app-log", "assist:state"];
    if (!allowed.includes(channel)) return () => undefined;
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener as never);
    return () => ipcRenderer.removeListener(channel, listener as never);
  },
});
