import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { isAllowed, makeForwardHandler } from '../src/endpoints/forward.js'

class UsersService {
  async readOne(id) {
    return { id, email: `${id}@example.org` }
  }
}

function request({ user = 'u1', method = 'POST', path, body, query = '' }) {
  return {
    method,
    path,
    originalUrl: `/inference${path}${query}`,
    body,
    schema: {},
    accountability: user ? { user } : null,
  }
}

// An express-like response that collects what is piped into it
function response() {
  const res = new PassThrough()
  res.statusCode = 200
  res.headers = {}
  res.sent = null
  res.status = (c) => {
    res.statusCode = c
  }
  res.setHeader = (k, v) => {
    res.headers[k] = v
  }
  res.send = (b) => {
    res.sent = b
  }
  res.text = new Promise((resolve) => {
    let out = ''
    res.on('data', (c) => (out += c))
    res.on('end', () => resolve(out))
  })
  return res
}

function upstream(status, chunks, headers = {}) {
  const body = new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk))
      c.close()
    },
  })
  return new Response(body, { status, headers })
}

function handler(fetchFn, { key = 'sk-play' } = {}) {
  return makeForwardHandler({
    url: 'http://litellm:4000',
    key,
    services: { UsersService },
    fetchFn,
  })
}

describe('isAllowed', () => {
  it('lets the playground calls through', () => {
    expect(isAllowed('GET', '/v1/model/info')).toBe(true)
    expect(isAllowed('POST', '/v1/chat/completions')).toBe(true)
    expect(isAllowed('POST', '/v1/videos')).toBe(true)
    expect(isAllowed('GET', '/v1/videos/abc123/content')).toBe(true)
  })

  it('keeps key management and other methods out', () => {
    expect(isAllowed('POST', '/v1/key/generate')).toBe(false)
    expect(isAllowed('GET', '/v1/user/info')).toBe(false)
    expect(isAllowed('GET', '/v1/chat/completions')).toBe(false)
    expect(isAllowed('DELETE', '/v1/videos/abc')).toBe(false)
    expect(isAllowed('GET', '/v1/videos/a/../../key/list')).toBe(false)
    expect(isAllowed('GET', '/v1/videos/..%2F..%2Fkey%2Flist')).toBe(false)
  })
})

describe('forward', () => {
  it('refuses anonymous calls', async () => {
    const res = response()
    await handler(() => {
      throw new Error('must not be called')
    })(request({ user: null, path: '/v1/models', method: 'GET' }), res)
    expect(res.statusCode).toBe(401)
  })

  it('answers 503 without a playground key', async () => {
    const res = response()
    await handler(() => {}, { key: '' })(
      request({ path: '/v1/models', method: 'GET' }),
      res
    )
    expect(res.statusCode).toBe(503)
  })

  it('answers 404 for paths it does not forward', async () => {
    const res = response()
    await handler(() => {
      throw new Error('must not be called')
    })(request({ path: '/v1/key/generate', body: {} }), res)
    expect(res.statusCode).toBe(404)
  })

  it('sends the key and who is asking, and passes the answer on', async () => {
    let seen
    const fetchFn = async (url, init) => {
      seen = { url, init }
      return upstream(200, ['{"ok":', 'true}'], {
        'content-type': 'application/json',
        'x-served-model': 'flux3-klein',
        'set-cookie': 'nope=1',
      })
    }
    const res = response()
    await handler(fetchFn)(
      request({
        path: '/v1/images/generations',
        body: { model: 'default-image', prompt: 'a heron' },
        query: '?x=1',
      }),
      res
    )
    expect(seen.url).toBe('http://litellm:4000/v1/images/generations?x=1')
    expect(seen.init.headers.Authorization).toBe('Bearer sk-play')
    expect(seen.init.headers['X-OpenWebUI-User-Id']).toBe('u1')
    expect(seen.init.headers['X-OpenWebUI-User-Email']).toBe('u1@example.org')
    expect(JSON.parse(seen.init.body).prompt).toBe('a heron')
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-served-model']).toBe('flux3-klein')
    expect(res.headers['set-cookie']).toBeUndefined()
    expect(await res.text).toBe('{"ok":true}')
  })

  it('streams chunk by chunk and keeps error statuses', async () => {
    const fetchFn = async () =>
      upstream(429, ['data: a\n\n', 'data: b\n\n'], {
        'content-type': 'text/event-stream',
      })
    const res = response()
    await handler(fetchFn)(
      request({ path: '/v1/chat/completions', body: { stream: true } }),
      res
    )
    expect(res.statusCode).toBe(429)
    expect(await res.text).toBe('data: a\n\ndata: b\n\n')
  })

  it('sends no body on GET', async () => {
    let seen
    const fetchFn = async (url, init) => {
      seen = init
      return upstream(200, ['{}'])
    }
    const res = response()
    await handler(fetchFn)(
      request({ path: '/v1/videos/abc', method: 'GET' }),
      res
    )
    expect(seen.body).toBeUndefined()
    expect(seen.headers['Content-Type']).toBeUndefined()
  })

  it('answers 502 when LiteLLM cannot be reached', async () => {
    const res = response()
    await handler(async () => {
      throw new Error('ECONNREFUSED')
    })(request({ path: '/v1/embeddings', body: {} }), res)
    expect(res.statusCode).toBe(502)
  })
})
