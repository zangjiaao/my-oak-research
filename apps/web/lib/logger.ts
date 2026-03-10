type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = parseLogLevel(process.env.LOG_LEVEL);
const appName = process.env.LOG_APP_NAME || "oak";

function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) return "info";
  const normalized = value.toLowerCase();
  if (normalized === "debug") return "debug";
  if (normalized === "warn") return "warn";
  if (normalized === "error") return "error";
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return levelWeight[level] >= levelWeight[configuredLevel];
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return error;
}

function stringifyLog(entry: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(entry, (_key, value: unknown) => {
    if (value instanceof Error) {
      return normalizeError(value);
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  });
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (!shouldLog(level)) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    app: appName,
    message,
    ...(context ? { context } : {}),
  };

  const line = stringifyLog(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(message: string, context?: LogContext) {
    emit("debug", message, context);
  },
  info(message: string, context?: LogContext) {
    emit("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    emit("warn", message, context);
  },
  error(message: string, context?: LogContext) {
    emit("error", message, context);
  },
  normalizeError,
};
