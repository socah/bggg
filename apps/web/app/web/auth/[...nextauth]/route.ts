import { handlers } from '@/auth';

// Catch-all route: Auth.js needs several paths under here (/signin,
// /callback/keycloak, /signout, /session, ...) and the [...nextauth]
// segment lets one file answer all of them — 'handlers' internally
// dispatches by the captured path.
//
// Lives at 'app/web/auth' (matching auth.ts's basePath: '/web/auth'), not
// Auth.js's own default 'app/api/auth' — see apps/web/app/web/login/route.ts's
// own comment for why '/api' needed to stay an unconditional "always the
// backend" rule instead of carving out an exception for this.
export const { GET, POST } = handlers;
