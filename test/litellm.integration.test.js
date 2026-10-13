// Runs against a real LiteLLM only when configured:
//   LITELLM_TEST_URL=http://localhost:4000 LITELLM_TEST_ADMIN_KEY=sk-… npm test
// The key must belong to a proxy_admin user (see README).
import { describe, expect, it } from 'vitest'
import { makeKeyHandlers } from '../src/endpoints/keys.js'
import { makeLiteLLM } from '../src/lib/litellm.js'

const url = process.env.LITELLM_TEST_URL
const adminKey = process.env.LITELLM_TEST_ADMIN_KEY

describe.skipIf(!url || !adminKey)('against a live LiteLLM', () => {
  const client = makeLiteLLM({ url, adminKey })
  const h = makeKeyHandlers(client, {
    durationDays: 180,
    limitsOverride: '',
    publicBaseUrl: null,
  })
  const user = { id: `it-${Date.now()}`, email: 'it@example.org' }
  const ctx = (body, params) => ({
    req: { body, params: params || {}, accountability: { user: user.id } },
    res: { status() {} },
    user,
    services: {
      UsersService: class {
        async readOne() {
          return { email: user.email, role: { name: 'HS Trier / Student' } }
        }
      },
    },
  })

  it('creates, uses, replaces and revokes a key', async () => {
    const first = await h.createKey(ctx({}))
    expect(first.key).toMatch(/^sk-/)

    const models = await fetch(`${url}/v1/models`, {
      headers: { Authorization: `Bearer ${first.key}` },
    })
    expect(models.status).toBe(200)
    const mint = await fetch(`${url}/key/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${first.key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    expect(mint.status).toBe(401)

    const listed = await h.listKeys(ctx())
    expect(listed.keys.map((k) => k.id)).toEqual([first.id])
    expect(listed.keys[0].expires).toBeTruthy()

    const second = await h.createKey(ctx({ replace: true }))
    expect((await h.listKeys(ctx())).keys.map((k) => k.id)).toEqual([second.id])
    const old = await fetch(`${url}/v1/models`, {
      headers: { Authorization: `Bearer ${first.key}` },
    })
    expect(old.status).toBe(401)

    expect(await h.deleteKey(ctx(undefined, { keyId: second.id }))).toEqual({
      deleted: second.id,
    })
    expect((await h.listKeys(ctx())).keys).toEqual([])
  })
})
