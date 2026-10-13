// The few LiteLLM key-management calls this extension needs. Verified against
// LiteLLM 1.105 with a proxy_admin (non-master) key. Key-level `tags` are an
// Enterprise feature, so the tier travels in `metadata` instead.

export class LiteLLMError extends Error {
  constructor(status, detail) {
    super(`LiteLLM ${status}: ${detail}`)
    this.status = status
  }
}

export function makeLiteLLM({ url, adminKey, fetchFn = fetch }) {
  async function call(method, path, body) {
    if (!url || !adminKey) throw new LiteLLMError(503, 'not configured')
    const res = await fetchFn(`${url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (!res.ok) throw new LiteLLMError(res.status, text.slice(0, 300))
    return text ? JSON.parse(text) : {}
  }

  return {
    // -> { key: 'sk-…' (shown once), token: '<hash>', key_name, expires, … }
    generate: (body) => call('POST', '/key/generate', body),
    // -> [{ token, key_name, key_alias, expires, created_at, last_active, metadata, user_id }]
    list: async (userId) => {
      const q = new URLSearchParams({
        user_id: userId,
        return_full_object: 'true',
        size: '100',
      })
      const out = await call('GET', `/key/list?${q}`)
      return out.keys || []
    },
    // -> { user_id, metadata, … } for a hashed token
    info: async (token) => {
      const out = await call(
        'GET',
        `/key/info?${new URLSearchParams({ key: token })}`
      )
      return out.info
    },
    // accepts hashed tokens
    remove: (tokens) => call('POST', '/key/delete', { keys: tokens }),
  }
}
