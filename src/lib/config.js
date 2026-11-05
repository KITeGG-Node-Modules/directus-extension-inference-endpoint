// Internal address of the LiteLLM proxy, e.g.
// http://sd-<deployment-id>-litellm.services:4000
export const litellmUrl = (process.env.INFERENCE_LITELLM_URL || '').replace(
  /\/+$/,
  ''
)

// Key of a LiteLLM user with role proxy_admin that exists only to issue keys.
// Not the master key: it can be revoked and rotated on its own.
export const litellmAdminKey = process.env.INFERENCE_LITELLM_ADMIN_KEY || ''

// Normal (not admin) key the LLP playground's calls go out with, via
// /inference/v1/*. Give it rpm and parallel limits of its own.
export const playgroundKey = process.env.INFERENCE_PLAYGROUND_KEY || ''

// Base URL shown to users next to their key, e.g. https://inference.kitegg.de/v1
export const publicBaseUrl = process.env.INFERENCE_PUBLIC_URL || null

// Personal keys expire after this many days; a new one is one click away.
export const keyDurationDays = Number(
  process.env.INFERENCE_KEY_DURATION_DAYS || 180
)

// Optional JSON override of the per-tier limits in tiers.js, e.g.
// {"student":{"rpm_limit":30}}
export const tierLimitsOverride = process.env.INFERENCE_TIER_LIMITS || ''
