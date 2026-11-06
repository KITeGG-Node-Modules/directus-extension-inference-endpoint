import { LiteLLMError } from '../lib/litellm.js'
import { ownKeys, planCreate, publicKey } from '../lib/keys.js'
import { institutionFor, limitsFor, tierFor } from '../lib/tiers.js'

// Handlers for /inference/keys. `client` is a makeLiteLLM() instance and
// `settings` the values from config.js; both injected so tests need no network.
export function makeKeyHandlers(client, settings) {
  async function whoami(ctx) {
    const { req, user, services } = ctx
    const users = new services.UsersService({
      schema: req.schema,
      accountability: req.accountability,
    })
    const me = await users.readOne(user.id, {
      fields: ['id', 'email', 'role.name'],
    })
    const tier = tierFor(me?.role?.name, req.accountability?.admin)
    const institution = institutionFor(me?.role?.name)
    return {
      me: { id: user.id, email: me?.email || user.email },
      tier,
      institution,
    }
  }

  function fail(res, err) {
    const status = err instanceof LiteLLMError ? 502 : 500
    if (err instanceof LiteLLMError && err.status === 503) {
      res.status(503)
      return { message: 'api_errors.service_unavailable' }
    }
    console.error('inference keys:', err.message)
    res.status(status)
    return { message: 'api_errors.internal_error' }
  }

  return {
    async listKeys(ctx) {
      try {
        const { me, tier } = await whoami(ctx)
        const keys = ownKeys(await client.list(me.id))
        return {
          tier,
          limits: limitsFor(tier, settings.limitsOverride),
          base_url: settings.publicBaseUrl,
          keys: keys.map(publicKey),
        }
      } catch (err) {
        return fail(ctx.res, err)
      }
    },

    async createKey(ctx) {
      try {
        const { me, tier, institution } = await whoami(ctx)
        const existing = ownKeys(await client.list(me.id))
        const plan = planCreate({
          user: me,
          tier,
          institution,
          existing,
          body: ctx.req.body || {},
          durationDays: settings.durationDays,
          limitsOverride: settings.limitsOverride,
        })
        if (plan.error) {
          ctx.res.status(plan.error.status)
          return { message: plan.error.message }
        }
        if (plan.toDelete.length) await client.remove(plan.toDelete)
        const created = await client.generate(plan.request)
        ctx.res.status(201)
        return { ...publicKey(created), key: created.key }
      } catch (err) {
        return fail(ctx.res, err)
      }
    },

    async deleteKey(ctx) {
      try {
        const { me, tier } = await whoami(ctx)
        const keyId = ctx.req.params.keyId
        let info = null
        try {
          info = await client.info(keyId)
        } catch (err) {
          if (!(err instanceof LiteLLMError) || err.status >= 500) throw err
        }
        // A key that isn't ours looks the same as one that doesn't exist.
        const mine = info?.user_id === me.id
        const issuedHere = info?.metadata?.source === 'llp'
        if (!info || !issuedHere || (!mine && tier !== 'admin')) {
          ctx.res.status(404)
          return { message: 'api_errors.not_found' }
        }
        await client.remove([keyId])
        return { deleted: keyId }
      } catch (err) {
        return fail(ctx.res, err)
      }
    },
  }
}
