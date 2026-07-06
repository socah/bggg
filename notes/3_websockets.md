# Group Chat — @nestjs/websockets, Socket.io, JWT Validation on Handshake

**Phase:** 3 — Frontend, Auth & Real-Time
**Topic ID:** `3_websockets`
**Date:** 2026-07-06
**SecOps:** Yes

---

## What Is This?

HTTP is request/response: the client asks, the server answers, the connection
closes. That model can't push a new chat message to someone who didn't ask for
it. A **WebSocket** is a single long-lived TCP connection that starts as a
normal HTTP request (the "handshake") and then upgrades — after that, either
side can send data at any time, in either direction, without a new request.

**Socket.io** is a library built on top of raw WebSockets. It adds automatic
reconnection, fallback to HTTP long-polling if a network blocks WebSockets,
and the concept of **rooms** — named groups of connected clients you can
broadcast to selectively (e.g. "everyone in group X's chat", not everyone
connected to the server).

`@nestjs/websockets` is NestJS's abstraction over Socket.io (or raw `ws`) that
lets you write a **Gateway** — a class that looks and behaves like a
controller, but for socket events instead of HTTP routes. It plugs into the
same dependency injection, guard, and pipe system you already have.

---

## Why Does It Matter for This Project?

Group chat needs to push messages to every connected member of a group the
instant one is sent — polling the REST API every few seconds would be wasteful
and laggy. More importantly, this is exactly the scenario `apps/api/src/auth/auth.guard.ts`
was already built for: the `extractToken` method has a comment on line 76
reading `// 'ws' branch will be added here in Phase 3 when group chat is
built.` That was not decoration — this topic is that Phase 3.

---

## The Decision

**Chose:** `@nestjs/websockets` with the Socket.io adapter, reusing the
existing `AuthGuard` by extending its `extractToken` method with a `'ws'`
branch.
**Because:** It integrates with NestJS's existing guard/DI system, so the
*same* JWT verification logic (JWKS fetch, issuer check, algorithm pinning)
that already protects REST endpoints protects socket connections too — zero
duplicated auth code, and one place to fix if a vulnerability is found.

**Alternative:** Raw `ws` library with hand-rolled connection handling.
**Drawback:** No built-in rooms (you'd have to track "who is in which group"
manually with a Map), no automatic reconnection, no fallback transport for
clients behind proxies that block raw WebSocket upgrades — and NestJS's
guard/pipe system doesn't attach to it, so auth would need to be reimplemented
outside the pattern already established.

**Alternative:** A separate standalone real-time microservice.
**Drawback:** Doubles the deployment surface (another container, another
health check, another thing Traefik must route) for a feature this project's
scale doesn't need. It would also need its own copy of the JWT validation
logic, working against the "transport-agnostic guard" design already in place.

**Secondary decision — where does the token travel?**
**Chose:** Socket.io's `handshake.auth.token` (sent once, at connection time,
outside the URL).
**Because:** Traefik (Phase 4) logs request URLs, including query strings, by
default. A token in a query string (`?token=eyJhbG...`) would leak into access
logs and browser history.
**Alternative:** Passing the token as a query parameter.
**Drawback:** Exactly the log/history leak above — this is a known JWT
anti-pattern, not a style preference.

---

## Worked Example

This is a minimal, standalone Socket.io + Express setup — no NestJS, no real
JWT library — just enough to see handshake-time auth and room broadcasting in
isolation.

### Scenario

A tiny chat server. Clients must present a "token" (here, just a string in a
lookup table standing in for a verified JWT) when connecting. Valid clients
join a room named after a group ID and can broadcast to just that room.

### Code / Configuration

```javascript
// server.js — minimal standalone example, not project code
const { Server } = require('socket.io');
const http = require('http');

const httpServer = http.createServer();
const io = new Server(httpServer, { cors: { origin: '*' } });

// Stand-in for a real JWKS-backed JWT check — same *shape* as jwtVerify().
const VALID_TOKENS = new Map([['token-abc', { sub: 'user-1' }]]);

// io.use() runs a middleware for EVERY connection attempt, before the
// 'connection' event fires — this is the handshake-time hook. Equivalent
// to a guard's canActivate() running before a controller method.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token; // sent by the client at connect time
  const user = VALID_TOKENS.get(token);

  if (!user) {
    // Calling next(Error) rejects the connection entirely — the client's
    // 'connect_error' event fires and no 'connection' event ever happens.
    return next(new Error('Unauthorized'));
  }

  // Attach identity to the socket, same way AuthGuard attaches req.user.
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  // 'join-group' is a custom event name — the client emits it after connecting.
  socket.on('join-group', (groupId) => {
    // socket.join() adds this socket to a Socket.io room. Rooms are
    // server-side only — the client has no visibility into who else is in one.
    socket.join(`group:${groupId}`);
  });

  socket.on('send-message', ({ groupId, text }) => {
    // io.to(room).emit() broadcasts ONLY to sockets that joined that room —
    // not to every connected client. This is what makes group chat isolated
    // per group instead of a global broadcast.
    io.to(`group:${groupId}`).emit('new-message', {
      from: socket.data.user.sub,
      text,
    });
  });
});

httpServer.listen(3001);
```

### What Is Happening Step by Step

1. `io.use(...)` registers a middleware that runs once, at connection time,
   for every client — this is the WebSocket equivalent of a guard.
2. The client must send `{ auth: { token: 'token-abc' } }` when calling
   `io('http://localhost:3001', { auth: { token: 'token-abc' } })` on its
   side. If it doesn't, `socket.handshake.auth.token` is `undefined` and the
   lookup fails.
3. `next(new Error(...))` inside the middleware rejects the handshake — the
   TCP upgrade never completes into a usable connection. No `'connection'`
   event fires for that client.
4. Once connected, `socket.data.user` carries identity for the lifetime of
   that connection — you don't re-verify the token on every message the way
   HTTP re-verifies on every request, because the connection itself is now
   trusted (this is a deliberate trade-off of the WebSocket model — see the
   "what would break" section).
5. `socket.join()` / `io.to().emit()` implement the room isolation — this is
   the mechanism that turns "broadcast to everyone" into "broadcast to
   members of group X only."

### What Would Break If You Changed X?

If the `io.use()` middleware were removed entirely, **any** client could
connect and immediately call `send-message` with a fabricated `sub` — there
would be no identity check at all, and anyone on the internet who found the
WebSocket URL could post messages as anyone. This is the WebSocket parallel
to removing `@UseGuards(AuthGuard)` from a REST controller.

A subtler break: if `socket.join(groupId)` were called **without checking
whether the connected user actually belongs to that group**, any
authenticated user (valid token, but for a different group) could join room
`group:<any-id>` and read/send messages in a chat they have no business being
in. Authentication (who are you) is not the same as authorization (are you
allowed to be in *this* room) — this is exactly the Broken Access Control
lesson from `notes/2_owasp.md`, applied to a new transport.

---

## Now Apply It

The transport-agnostic groundwork is already sitting in the codebase waiting
for this topic:

- `apps/api/src/auth/auth.guard.ts:76` — the `extractToken` method has a
  `'ws'` stub comment. This is where a `context.switchToWs().getClient()` branch
  reads `client.handshake?.auth?.token`, matching the pattern already used for
  `'http'` two lines above it.
- `apps/api/src/groups/group.entity.ts` and `groups.service.ts` — chat rooms
  are scoped per group. The `ownerId` check pattern in `GroupsService.findOne()`
  is the same shape of check a chat gateway needs before letting a socket
  `join` a group's room (today: owner-only, since group membership beyond the
  owner doesn't exist until `3_invite_system` is built).
- New files to be built this session:
  - `apps/api/src/chat/chat.module.ts`
  - `apps/api/src/chat/chat.gateway.ts` — the `@WebSocketGateway()` class
  - `apps/api/src/chat/message.entity.ts` — persisted chat history
  - `apps/api/src/chat/chat.service.ts` — save/retrieve messages

---

## SecOps Notes

**Security property upheld:** The same token-authenticity guarantee that
protects REST endpoints (signature, issuer, algorithm pinning via `jose` +
JWKS) now also protects the WebSocket transport, with no separate/weaker auth
path.

**What attack does this mitigate?** Without handshake-time validation, the
`/socket.io/` endpoint would be an *unauthenticated* side door into the
application — even though every REST route is guarded, anyone could connect
directly via Socket.io and impersonate any user in chat, bypassing all the JWT
work already done in `2_guards_pipes` and `3_keycloak`.

**What would go wrong if this step were skipped?** Two separate failure
modes, both covered above: (1) skipping handshake auth entirely — anonymous
access; (2) validating identity but not room membership — authenticated
cross-group access, an IDOR-shaped bug (see `notes/2_owasp.md`) applied to
chat rooms instead of REST resource IDs.

**Reference checklist (`references/secops.md` → Transport-Agnostic Auth
Guard):**
- [ ] `extractToken` handles both `'http'` and `'ws'` context types
- [ ] WebSocket client sends token in `handshake.auth.token` (not query string)
- [ ] Same `validateToken` / `jwtVerify` logic used for both transports — no duplication
- [ ] Room join checks group ownership/membership, not just "has a valid token"

---

## Checkpoint Questions

1. Why does the `AuthGuard`'s `extractToken` method need a `'ws'` branch
   instead of just writing a completely separate `WsAuthGuard` from scratch?
2. If a user has a perfectly valid, unexpired JWT but tries to join the room
   for a group they don't own, what should happen — and where should that
   check live (the guard, or the gateway's `join-group` handler)? Why there?
3. Why is putting the JWT in `handshake.auth.token` preferred over putting it
   in the connection URL as a query parameter?
4. Once a socket connection is authenticated, messages flow over it without
   re-checking the JWT on every single message. What does that trade off, and
   why is it acceptable here?
5. If we removed the `io.use()` (or NestJS equivalent) middleware entirely,
   what is the very first thing an attacker could do?

---

## Summary

Built: `AuthGuard` extended to handle the `'ws'` context type (both extracting
the token from `handshake.auth.token` and attaching the verified identity to
`client.data.user` — a real bug caught mid-session, since the original code
unconditionally called `switchToHttp()` regardless of transport); a `Message`
entity following the codebase's existing flat-column convention; `ChatService`,
which reuses `GroupsService.findOne()` for authorization instead of
duplicating the ownership check; `ChatGateway`, guarded at the class level so
every `@SubscribeMessage` handler re-validates the JWT (a deliberate departure
from the simplified worked example's "verify once at connect" model, chosen
because NestJS doesn't route `handleConnection` through the guard pipeline,
and because it reuses `AuthGuard` with zero duplicated logic); and the
`ChatModule` + `IoAdapter` wiring to make it all reachable.

Demonstrated understanding of: the transport-agnostic guard pattern end to
end (predicted correctly before seeing code); the authentication-vs-
authorization distinction applied to WebSocket rooms; why plain foreign-key
columns trade away automatic joins for decoupling (using `AuditLog` as the
reference pattern); why `context.switchToHttp()` silently misbehaves for a
`ws`-type context even though it doesn't throw; and a sound production
debugging strategy (check persistence first to bisect sender-side vs.
receiver-side failures).

To revisit: none identified this session — all checkpoints were answered
correctly, sometimes with a follow-up needed to sharpen the reasoning (the
`@ManyToOne` vs. plain-column checkpoint took a guiding question to get from
"cardinality" to "join behavior").
