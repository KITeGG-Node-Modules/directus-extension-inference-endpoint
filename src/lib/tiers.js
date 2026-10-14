// Who gets which limits. Directus roles are named "<Institution> / <Role>"
// (see kitegg-llp-www src/access/roles.js); Administrator is Directus' own.
//
// student: everyone without a staff or management role, including External
// staff:   "/ Staff"
// admin:   "/ Management" and Administrator. No limits, and may create
//          additional keys with a label and their own expiry.

export const TIERS = ['student', 'staff', 'admin']

// LiteLLM key fields. Spend is in GPU-seconds: the prices in LiteLLM's
// config (kitegg-inference, recipes/litellm-proxy) make cost = GPU-seconds.
// max_budget is per day and resets at 00:00 UTC. rpm/tpm/parallel stay as
// guard rails against bursts.
export const DEFAULT_LIMITS = {
  student: {
    rpm_limit: 60,
    tpm_limit: 200000,
    max_parallel_requests: 2,
    max_budget: 3600,
    budget_duration: '1d',
  },
  staff: {
    rpm_limit: 300,
    tpm_limit: 1000000,
    max_parallel_requests: 8,
    max_budget: 14400,
    budget_duration: '1d',
  },
  admin: {},
}

// Active keys a user may hold at once. Students and staff have one key;
// generating a new one replaces it.
export const MAX_KEYS = { student: 1, staff: 1, admin: 20 }

export function tierFor(roleName, isAdmin = false) {
  if (isAdmin || roleName === 'Administrator') return 'admin'
  if (typeof roleName !== 'string') return 'student'
  if (roleName.endsWith('/ Management')) return 'admin'
  if (roleName.endsWith('/ Staff')) return 'staff'
  return 'student'
}

export function limitsFor(tier, override = '') {
  let extra = {}
  if (override) {
    try {
      extra = JSON.parse(override)?.[tier] || {}
    } catch {
      extra = {}
    }
  }
  return { ...DEFAULT_LIMITS[tier], ...extra }
}
