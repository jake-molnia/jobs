import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "apply" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: ["authorization", "token", "password", "req.headers.authorization"],
}, pino.destination(2));

export function errorDetails(error: unknown) {
  return {
    stackFrames: error instanceof Error ? error.stack?.split("\n").slice(1).filter((line) => /^\s+at /.test(line)).slice(0, 8) : undefined,
    errorNumber: typeof error === "object" && error !== null && "errcode" in error
      && typeof error.errcode === "number" ? error.errcode : undefined,
    errorType: error instanceof Error ? error.name : "UnknownError",
    errorCode: typeof error === "object" && error !== null && "code" in error
      && typeof error.code === "string" ? error.code : undefined,
  };
}
