import { beforeEach, describe, expect, it } from 'vitest'
import { makeKeyHandlers } from '../src/endpoints/keys.js'
import { LiteLLMError } from '../src/lib/litellm.js'

// In-memory stand-in for the LiteLLM key API, shaped like LiteLLM 1.105's answers.
function fakeLiteLLM() {
  const keys = new Map()
  let n = 0
  return {
    keys,
    generate: async (body) => {
      n += 1
      const token = `hash${n}`
      const row = {
        token,
        key_name: `sk-...${n}`,
        key_alias: body.key_alias,
        user_id: body.user_id,
        metadata: body.metadata,
        expires: body.duration ? '2099-01-01T00:00:00Z' : null,
        created_at: '2026-10-13T00:00:00Z',
        last_active: null,
        body,
      }
      keys.set(token, row)
      return { ...row, key: `sk-secret-${n}` }
    },
    list: async (userId) =>
      [...keys.values()].filter((k) => k.user_id === userId),
    info: async (token) => {
      if (!keys.has(token)) throw new LiteLLMError(404, 'not found')
      return keys.get(token)
    },
    remove: async (tokens) => tokens.forEach((t) => keys.delete(t)),
  }
}

function ctx(user, role, { body, params, admin = false } = {}) {
  const res = {
    statusCode: 200,
    status(c) {
      this.statusCode = c
    },
  }
  class UsersService {
    async readOne() {
      return { id: user.id, email: user.email, role: { name: role } }
    }
  }
  return {
    req: {
      body,
      params: params || {},
      accountability: { user: user.id, admin },
    },
    res,
    user,
    services: { UsersService },
  }
}

const settings = {
  durationDays: 180,
  limitsOverride: '',
  publicBaseUrl: 'https://x/v1',
}
const ann = { id: 'u-ann', email: 'ann@hs-trier.de' }
const bob = { id: 'u-bob', email: 'bob@hs-mainz.de' }
const boss = { id: 'u-boss', email: 'boss@hs-trier.de' }

describe('inference key endpoints', () => {
  let llm, h
  beforeEach(() => {
    llm = fakeLiteLLM()
    h = makeKeyHandlers(llm, settings)
  })

  it('starts with no key and reports tier, limits and base URL', async () => {
    const out = await h.listKeys(ctx(ann, 'HS Trier / Student'))
    expect(out).toMatchObject({
      tier: 'student',
      keys: [],
      base_url: 'https://x/v1',
    })
    expect(out.limits.rpm_limit).toBe(60)
  })

  it('creates a student key with limits, 180-day expiry and the secret once', async () => {
    const c = ctx(ann, 'HS Trier / Student')
    const out = await h.createKey(c)
    expect(c.res.statusCode).toBe(201)
    expect(out.key).toBe('sk-secret-1')
    const sent = llm.keys.get(out.id).body
    expect(sent).toMatchObject({
      user_id: 'u-ann',
      duration: '180d',
      rpm_limit: 60,
      max_budget: 3600,
      budget_duration: '1d',
    })
    expect(sent.metadata).toMatchObject({
      source: 'llp',
      tier: 'student',
      email: 'ann@hs-trier.de',
    })
    const listed = await h.listKeys(ctx(ann, 'HS Trier / Student'))
    expect(listed.keys).toHaveLength(1)
    expect(listed.keys[0]).not.toHaveProperty('key')
  })

  it('refuses a second key unless asked to replace the first', async () => {
    await h.createKey(ctx(ann, 'HS Trier / Student'))
    const again = ctx(ann, 'HS Trier / Student')
    expect(await h.createKey(again)).toEqual({
      message: 'api_errors.inference_key_exists',
    })
    expect(again.res.statusCode).toBe(409)

    const out = await h.createKey(
      ctx(ann, 'HS Trier / Student', { body: { replace: true } })
    )
    expect(out.key).toBe('sk-secret-2')
    expect([...llm.keys.keys()]).toEqual(['hash2'])
  })

  it('ignores label and expiry from non-admins', async () => {
    const out = await h.createKey(
      ctx(bob, 'HS Mainz / Staff', { body: { label: 'x', expires_in_days: 0 } })
    )
    const sent = llm.keys.get(out.id).body
    expect(sent.duration).toBe('180d')
    expect(sent.metadata.label).toBeNull()
    expect(sent.rpm_limit).toBe(300)
  })

  it('lets admins hold several unlimited keys with label and no expiry', async () => {
    await h.createKey(ctx(boss, 'HS Trier / Management'))
    const out = await h.createKey(
      ctx(boss, 'HS Trier / Management', {
        body: { label: 'Kurs KI-Design', expires_in_days: 0 },
      })
    )
    const sent = llm.keys.get(out.id).body
    expect(sent).not.toHaveProperty('duration')
    expect(sent).not.toHaveProperty('rpm_limit')
    expect(sent).not.toHaveProperty('max_budget')
    expect(out.label).toBe('Kurs KI-Design')
    expect(
      (await h.listKeys(ctx(boss, 'HS Trier / Management'))).keys
    ).toHaveLength(2)
  })

  it('rejects a nonsense expiry from admins', async () => {
    const c = ctx(boss, 'Administrator', { body: { expires_in_days: -3 } })
    await h.createKey(c)
    expect(c.res.statusCode).toBe(400)
  })

  it('deletes only your own key; someone else gets a 404', async () => {
    const out = await h.createKey(ctx(ann, 'HS Trier / Student'))
    const theft = ctx(bob, 'HS Mainz / Staff', { params: { keyId: out.id } })
    expect(await h.deleteKey(theft)).toEqual({
      message: 'api_errors.not_found',
    })
    expect(theft.res.statusCode).toBe(404)
    expect(llm.keys.has(out.id)).toBe(true)

    const own = ctx(ann, 'HS Trier / Student', { params: { keyId: out.id } })
    expect(await h.deleteKey(own)).toEqual({ deleted: out.id })
    expect(llm.keys.has(out.id)).toBe(false)
  })

  it('lets admins revoke anyone’s LLP key, but not keys issued elsewhere', async () => {
    const out = await h.createKey(ctx(ann, 'HS Trier / Student'))
    expect(
      await h.deleteKey(
        ctx(boss, 'Administrator', { params: { keyId: out.id } })
      )
    ).toEqual({ deleted: out.id })

    llm.keys.set('chat1', {
      token: 'chat1',
      user_id: 'openwebui',
      metadata: {},
    })
    const c = ctx(boss, 'Administrator', { params: { keyId: 'chat1' } })
    await h.deleteKey(c)
    expect(c.res.statusCode).toBe(404)
    expect(llm.keys.has('chat1')).toBe(true)
  })

  it('does not list expired keys or keys from other sources', async () => {
    llm.keys.set('old', {
      token: 'old',
      user_id: 'u-ann',
      metadata: { source: 'llp' },
      expires: '2020-01-01T00:00:00Z',
    })
    llm.keys.set('ui', { token: 'ui', user_id: 'u-ann', metadata: {} })
    expect((await h.listKeys(ctx(ann, 'HS Trier / Student'))).keys).toEqual([])
    // and an expired key does not block a new one
    expect((await h.createKey(ctx(ann, 'HS Trier / Student'))).key).toBeTruthy()
  })

  it('answers 503 when LiteLLM is not configured', async () => {
    h = makeKeyHandlers(
      {
        list: async () => {
          throw new LiteLLMError(503, 'not configured')
        },
      },
      settings
    )
    const c = ctx(ann, 'HS Trier / Student')
    expect(await h.listKeys(c)).toEqual({
      message: 'api_errors.service_unavailable',
    })
    expect(c.res.statusCode).toBe(503)
  })
})
