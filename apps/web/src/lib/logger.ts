type LogPayload = Record<string, unknown>;

export function logInfo(event: string, payload: LogPayload = {}) {
  console.log(JSON.stringify({ level: "info", event, ...payload }));
}

export function logError(event: string, payload: LogPayload = {}) {
  console.error(JSON.stringify({ level: "error", event, ...payload }));
}
