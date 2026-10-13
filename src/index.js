import { baseRequestHandler } from 'kitegg-directus-extension-common'
import { makeKeyHandlers } from './endpoints/keys.js'
import { makeLiteLLM } from './lib/litellm.js'
import {
  keyDurationDays,
  litellmAdminKey,
  litellmUrl,
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
  },
}
