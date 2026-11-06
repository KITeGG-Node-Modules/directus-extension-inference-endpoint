import { baseRequestHandler } from 'kitegg-directus-extension-common'
import { makeForwardHandler } from './endpoints/forward.js'
import { makeKeyHandlers } from './endpoints/keys.js'
import { makeLiteLLM } from './lib/litellm.js'
import {
  keyDurationDays,
  litellmAdminKey,
  litellmUrl,
  playgroundKey,
  publicBaseUrl,
  tierLimitsOverride,
} from './lib/config.js'

export default {
  id: 'inference',
  handler: (router, context) => {
    const handlers = makeKeyHandlers(
      makeLiteLLM({ url: litellmUrl, adminKey: litellmAdminKey }),
      {
        durationDays: keyDurationDays,
        limitsOverride: tierLimitsOverride,
        publicBaseUrl,
      }
    )

    router.get('/keys', baseRequestHandler(handlers.listKeys, context))
    router.post('/keys', baseRequestHandler(handlers.createKey, context))
    router.delete(
      '/keys/:keyId',
      baseRequestHandler(handlers.deleteKey, context)
    )

    // The playground: its own login check, not baseRequestHandler, which
    // asks Keycloak for groups on every call (chat streams, video polls).
    router.all(
      /^\/v1\/.*/,
      makeForwardHandler({
        url: litellmUrl,
        key: playgroundKey,
        services: context.services,
      })
    )
  },
}
