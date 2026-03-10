export function json<T>(data: T, init: number | ResponseInit = 200) {
  const initObj: ResponseInit = typeof init === 'number' ? { status: init } : init
  return Response.json(data as unknown as unknown, initObj)
}


export function badRequest(message: string, details?: unknown) {
  return json({ error: message, details }, 400)
}


export function notFound(message = 'Not Found') {
  return json({ error: message }, 404)
}


export function conflict(message = 'Conflict', details?: unknown) {
  return json({ error: message, details }, 409)
}


export function serverError(e: unknown) {
  console.error(e)
  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(process.cwd(), 'error.log');
    const msg = `[${new Date().toISOString()}] ${e instanceof Error ? e.stack : JSON.stringify(e)}\n`;
    fs.appendFileSync(logPath, msg);
  } catch (err) {
    // Ignore log errors
  }
  return json({ error: 'Internal Server Error' }, 500)
}