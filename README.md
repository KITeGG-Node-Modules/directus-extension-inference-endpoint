# directus-extension-inference-endpoint

Personal API keys for the KITeGG inference service (the LiteLLM proxy), issued from the LLP account page. Users log in to the LLP as usual; this endpoint mints, lists and revokes their LiteLLM keys. Nobody hands out keys by hand.

## Endpoints

All under `/inference`, behind the usual `baseRequestHandler` login.

| Method | Path | What |
|---|---|---|
| `GET` | `/keys` | your active keys (never the secret, but with today's `spend`, `max_budget` and `budget_reset_at`), your tier, its limits and the public base URL |
| `POST` | `/keys` | create a key; returns the secret **once**. Body: `{ "replace": true }` to swap your existing key; admins also `{ "label": "…", "expires_in_days": 0–3650 }` (0 = never) |
| `DELETE` | `/keys/:keyId` | revoke a key by its id (LiteLLM's hashed token). Your own; admins may revoke any key issued here |

## Who gets what

The tier comes from the Directus role name (`<Institution> / <Role>`):

| Tier | Roles | Keys | Limits (defaults, `src/lib/tiers.js`) |
|---|---|---|---|
| student | `/ Student`, anything unknown | 1 | 1 GPU-hour/day (3600), 60 req/min, 200k tokens/min, 2 parallel |
| staff | `/ Staff` | 1 | 4 GPU-hours/day (14400), 300 req/min, 1M tokens/min, 8 parallel |
| admin | `/ Management`, Administrator | up to 20, with label and own expiry | none |

The institution (`hfgo`, `hfgg`, `hsm`, `hst`, `kisd`, `ext`; `other` for one not in `INSTITUTION_CODES`, none for Administrator) is the part of the role name before the slash. It is written into the key's metadata next to the tier, and the inference door exposes `tier`, `institution` and `label` as Prometheus labels, so usage can be grouped by role and school. Keys issued before this carry no institution until their metadata is updated; LiteLLM replaces the whole `metadata` field on update, so an update must send all of it.

Keys expire after 180 days; the account page offers a new one. Nobody has a key until they ask for one.

The daily budget is LiteLLM's per-key `max_budget` with `budget_duration: "1d"`. LiteLLM counts it in dollars; here one "dollar" is one GPU-second, because the model prices in LiteLLM's config are set so that cost = GPU-seconds. Those prices live in the kitegg-inference repo (`recipes/litellm-proxy`), not here. The budget resets at 00:00 UTC; over budget, requests get 422 until then. Spend is written a few seconds after each request, so the account page lags slightly.

## Configuration

| Env | Meaning |
|---|---|
| `INFERENCE_LITELLM_URL` | internal proxy address, e.g. `http://sd-<deployment-id>-litellm.services:4000` |
| `INFERENCE_LITELLM_ADMIN_KEY` | key of a LiteLLM `proxy_admin` user created only for this (below) |
| `INFERENCE_PUBLIC_URL` | base URL shown to users, e.g. `https://inference.kitegg.de/v1` (optional) |
| `INFERENCE_KEY_DURATION_DAYS` | default 180 |
| `INFERENCE_TIER_LIMITS` | optional JSON override, e.g. `{"student":{"rpm_limit":30}}` |

Without URL and key the endpoints answer 503.

### The issuer key

Use a dedicated `proxy_admin` user, not the master key, so it can be rotated or revoked on its own:

```sh
curl $LITELLM/user/new -H "Authorization: Bearer $MASTER" -H 'Content-Type: application/json' \
  -d '{"user_id":"llp-service","user_role":"proxy_admin","user_alias":"LLP key issuer"}'
curl $LITELLM/key/generate -H "Authorization: Bearer $MASTER" -H 'Content-Type: application/json' \
  -d '{"user_id":"llp-service","key_alias":"llp-issuer"}'
```

A `proxy_admin` key can manage every key on the proxy, so keep the admin API off the public route: route only `/v1` to LiteLLM from outside.

### LiteLLM facts this relies on

Checked against LiteLLM 1.105 (`test/litellm.integration.test.js`):

- a `proxy_admin` user's key can `/key/generate`, `/key/list`, `/key/info` and `/key/delete`; a normal key gets 401/403 on the first three and can read `/key/info` only for itself;
- `/key/delete` accepts the hashed token, and the key stops working immediately;
- key-level `tags` are Enterprise-only, so the tier goes into `metadata` (`source: "llp"`, `tier`, `institution`, `email`, `label`).

## Develop

```sh
npm install
npm test          # unit tests; the integration test is skipped
LITELLM_TEST_URL=http://localhost:4000 LITELLM_TEST_ADMIN_KEY=sk-… npm test
npm run build     # dist/ is committed: the Directus image installs from GitHub
```
