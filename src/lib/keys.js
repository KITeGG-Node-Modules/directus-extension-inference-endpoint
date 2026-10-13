import { MAX_KEYS, limitsFor } from './tiers.js'

export const SOURCE = 'llp'

// What the browser may see of a key. Never the secret: LiteLLM only keeps a
// hash, and the secret is returned once, on creation.
export function publicKey(k) {
  return {
    id: k.token,
    name: k.key_name,
    label: k.metadata?.label || null,
    tier: k.metadata?.tier || null,
    created_at: k.created_at || null,
    expires: k.expires || null,
    last_active: k.last_active || null,
  }
}

export function isActive(k, now = Date.now()) {
  return !k.expires || new Date(k.expires).getTime() > now
}

// Keys this extension issued for the user and that still work.
export function ownKeys(keys, now = Date.now()) {
  return keys.filter((k) => k.metadata?.source === SOURCE && isActive(k, now))
}

// Turn a create request into a /key/generate body, or an error.
// body: { label?, expires_in_days?, replace? } — label and expires_in_days are
// honoured for admins only; 0 days means no expiry.
export function planCreate({
  user,
  tier,
  existing,
  body = {},
  durationDays,
  limitsOverride,
}) {
  const isAdmin = tier === 'admin'
  const toDelete = []
  if (existing.length >= MAX_KEYS[tier]) {
    if (!isAdmin && body.replace === true) {
      toDelete.push(...existing.map((k) => k.token))
    } else {
      return {
        error: {
          status: 409,
          message: isAdmin
            ? 'api_errors.inference_key_limit'
            : 'api_errors.inference_key_exists',
        },
      }
    }
  }

  let days = durationDays
  if (isAdmin && body.expires_in_days != null) {
    const d = Number(body.expires_in_days)
    if (!Number.isInteger(d) || d < 0 || d > 3650) {
      return { error: { status: 400, message: 'api_errors.bad_request' } }
    }
    days = d
  }

  const label =
    isAdmin && typeof body.label === 'string'
      ? body.label.trim().slice(0, 80) || null
      : null
  const suffix = Math.random().toString(36).slice(2, 8)

  const request = {
    user_id: user.id,
    key_alias: `${SOURCE}/${user.email || user.id}/${suffix}`,
    metadata: { source: SOURCE, tier, email: user.email || null, label },
    ...limitsFor(tier, limitsOverride),
  }
  if (days > 0) request.duration = `${days}d`
  return { request, toDelete }
}
