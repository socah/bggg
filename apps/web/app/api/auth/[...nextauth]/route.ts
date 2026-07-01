import { handlers } from '@/auth';

// Catch-all route: Auth.js needs several paths under here (/signin,
// /callback/keycloak, /signout, /session, ...) and the [...nextauth]
// segment lets one file answer all of them — 'handlers' internally
// dispatches by the captured path.
export const { GET, POST } = handlers;
