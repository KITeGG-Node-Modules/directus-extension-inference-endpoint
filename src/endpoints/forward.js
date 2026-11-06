import { Readable } from 'node:stream'

// Forwards the LLP playground's calls to LiteLLM with one server-side key, so
// the browser never holds a key. The logged-in user travels in
// X-OpenWebUI-User-Id, which the door maps to LiteLLM's `customer`: spend is
// counted, and limits apply, per person.

// Only what the playground uses; never /key/*, /user/* or the admin UI.
const ALLOWED = [
  ['GET', /^\/v1\/models$/],
  ['GET', /^\/v1\/model\/info$/],
  ['POST', /^\/v1\/chat\/completions$/],
  ['POST', /^\/v1\/images\/generations$/],
  ['POST', /^\/v1\/embeddings$/],
  ['POST', /^\/v1\/decisions$/],
  ['POST', /^\/v1\/videos$/],
  // video ids are base64-like; no %, dots or slashes, so nothing decodes
  // into another path upstream
  ['GET', /^\/v1\/videos\/[\w=+-]+$/],
  ['GET', /^\/v1\/videos\/[\w=+-]+\/content$/],
]

// Answer headers worth passing on; the rest (cookies, CORS, lengths) are ours.
const PASS_HEADERS = [
  'content-type',
  'cache-control',
  'x-served-model',
  'x-litellm-response-cost',
]

export const isAllowed = (method, path) =>
  ALLOWED.some(([m, re]) => m === method && re.test(path))

export function makeForwardHandler({ url, key, services, fetchFn = fetch }) {
  // Emails for the spend log, so a call costs one user lookup at most
  const emails = new Map()
  async function emailOf(req) {
    const id = req.accountability.user
    if (!emails.has(id)) {
      try {
        const users = new services.UsersService({
          schema: req.schema,
          accountability: req.accountability,
        })
        emails.set(id, (await users.readOne(id, { fields: ['email'] }))?.email)
      } catch {
        emails.set(id, null)
      }
    }
    return emails.get(id)
  }

  return async function forward(req, res) {
    if (!req.accountability?.user) {
      res.status(401)
      return res.send({ message: 'api_errors.unauthorized' })
    }
    if (!url || !key) {
      res.status(503)
      return res.send({ message: 'api_errors.service_unavailable' })
    }
    const path = req.path
    if (!isAllowed(req.method, path)) {
      res.status(404)
      return res.send({ message: 'api_errors.not_found' })
    }

    const email = await emailOf(req)
    const query = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : ''
    const hasBody = req.method === 'POST'
    // Stop the model when the browser goes away (closed tab, Stop button)
    const abort = new AbortController()
    res.on('close', () => abort.abort())

    let upstream
    try {
      upstream = await fetchFn(`${url}${path}${query}`, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${key}`,
          'X-OpenWebUI-User-Id': req.accountability.user,
          ...(email ? { 'X-OpenWebUI-User-Email': email } : {}),
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
        signal: abort.signal,
      })
    } catch (err) {
      if (abort.signal.aborted) return
      console.error('inference forward:', err.message)
      res.status(502)
      return res.send({ message: 'api_errors.service_unavailable' })
    }

    res.status(upstream.status)
    for (const h of PASS_HEADERS) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    // Streams (chat), JSON and video files alike, without buffering
    if (!upstream.body) return res.end()
    Readable.fromWeb(upstream.body)
      .on('error', () => res.end())
      .pipe(res)
  }
}
