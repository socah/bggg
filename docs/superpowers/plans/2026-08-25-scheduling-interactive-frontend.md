# Scheduling Interactive Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every scheduling mutation into the web UI (create → RSVP → confirm → lock-in → finalize/undo/cancel, game voting, iCal feed management) and close the three backend gaps (no cancel endpoint, no group library endpoint, CORS missing PUT).

**Architecture:** Small backend additions to the existing `SchedulingService`/`GroupsService`; frontend follows the established pattern of client-side `apiFetch` hooks with fetch-in-effect + `refreshKey` refetch (Approach A — TanStack Query is the documented migration path, not used now). The existing proposal detail panel becomes the action hub, composed from focused section components.

**Tech Stack:** NestJS 11 + TypeORM + Jest (API); Next.js 16 + React 19 + Radix UI + Tailwind 4 (web). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-scheduling-interactive-frontend-design.md`

## Global Constraints

- No new npm dependencies in either app.
- Follow the codebase's "plain column holding Keycloak sub, no relation" identity pattern; never invent a users-table FK.
- API tests are Jest unit tests with mocked repositories (`getRepositoryToken(Entity)` providers) — no database.
- Web app has NO test runner. Web verification is always: `npm run lint -w @bggg/web` then `npm run build -w @bggg/web`.
- API test command from repo root: `npm test -w @bggg/api -- <file-substring>` (e.g. `npm test -w @bggg/api -- scheduling.service`).
- Conventional commits (`feat:`, `fix:`, `test:`), matching repo history style.
- Comments only where they carry non-obvious rationale (repo convention: heavy on "why", silent on "what").
- All work happens on a branch created from current `main` at execution start.

---

### Task 1: Cancel endpoint (POST /proposals/:id/cancel)

**Files:**
- Modify: `apps/api/src/scheduling/scheduling.service.ts`
- Modify: `apps/api/src/scheduling/proposals.controller.ts`
- Test: `apps/api/src/scheduling/scheduling.service.spec.ts`

**Interfaces:**
- Consumes: existing `assertCanManageProposal(proposal, userId)` (private, already handles creator-or-owner/admin), `findProposalOrThrow`, `this.sessions` repository.
- Produces: `SchedulingService.cancel(proposalId: string, requestingUserId: string): Promise<PlaySessionProposal>` — sets `status='cancelled'`, deletes any linked `play_sessions` row first when status was `confirmed`. Terminal state.

- [ ] **Step 1: Write failing tests**

In `apps/api/src/scheduling/scheduling.service.spec.ts`, make these changes:

Update imports (add ConflictException, ForbiddenException):

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException } from '@nestjs/common';
```

Extend the shared mocks so cancel's dependencies exist (replace these three declarations):

```ts
const mockProposals = { findOneBy: jest.fn(), save: jest.fn() };
const mockSessions = { findOneBy: jest.fn(), remove: jest.fn() };
const mockMembers = { findOneBy: jest.fn() };
```

Add this describe block inside the top-level `describe('SchedulingService')`:

```ts
describe('cancel', () => {
  const baseProposal = (): PlaySessionProposal => ({
    id: PROPOSAL_ID, groupId: GROUP_ID, createdBy: USER_ID, proposedDate: '2026-08-30',
    hostId: null, status: 'collecting', confirmedStart: null, confirmedEnd: null, createdAt: new Date(),
  });

  it('cancels a collecting proposal without touching play_sessions', async () => {
    mockProposals.findOneBy.mockResolvedValue(baseProposal());
    mockProposals.save.mockImplementation(async (p: PlaySessionProposal) => p);

    const result = await service.cancel(PROPOSAL_ID, USER_ID);

    expect(result.status).toBe('cancelled');
    expect(mockSessions.findOneBy).not.toHaveBeenCalled();
  });

  it('deletes the linked session BEFORE flipping a confirmed proposal to cancelled', async () => {
    const proposal = {
      ...baseProposal(),
      status: 'confirmed' as const,
      confirmedStart: new Date('2026-08-30T18:00:00Z'),
      confirmedEnd: new Date('2026-08-30T23:00:00Z'),
    };
    mockProposals.findOneBy.mockResolvedValue(proposal);
    mockProposals.save.mockImplementation(async (p: PlaySessionProposal) => p);
    const session = {
      id: 'session-1', groupId: GROUP_ID, playedAt: new Date(),
      notes: null, proposalId: PROPOSAL_ID, createdAt: new Date(),
    };
    mockSessions.findOneBy.mockResolvedValue(session);

    await service.cancel(PROPOSAL_ID, USER_ID);

    expect(mockSessions.remove).toHaveBeenCalledWith(session);
    // Delete-before-flip: the session must be gone before the proposal row
    // loses its 'confirmed' status — same ordering guarantee undo() relies on.
    expect(mockSessions.remove.mock.invocationCallOrder[0]).toBeLessThan(
      mockProposals.save.mock.invocationCallOrder[0],
    );
  });

  it('rejects cancelling an already-cancelled proposal', async () => {
    mockProposals.findOneBy.mockResolvedValue({ ...baseProposal(), status: 'cancelled' });

    await expect(service.cancel(PROPOSAL_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('forbids a plain member who is neither creator nor owner/admin', async () => {
    mockProposals.findOneBy.mockResolvedValue({ ...baseProposal(), createdBy: 'someone-else' });
    mockMembers.findOneBy.mockResolvedValue({
      id: 1, userId: USER_ID, groupId: GROUP_ID, role: 'member', joinedAt: new Date(),
    });

    await expect(service.cancel(PROPOSAL_ID, USER_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @bggg/api -- scheduling.service`
Expected: FAIL — `service.cancel is not a function`.

- [ ] **Step 3: Implement**

In `apps/api/src/scheduling/proposals.controller.ts`, add after the `undo` route:

```ts
// POST /proposals/:id/cancel → terminal state from ANY active status. A
// confirmed game night can still be called off in real life; if a
// play_sessions row exists it is deleted first (see SchedulingService.cancel).
@Post(':id/cancel')
cancel(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
  return this.schedulingService.cancel(id, req.user.sub);
}
```

In `apps/api/src/scheduling/scheduling.service.ts`, add after `undo()`:

```ts
// POST /proposals/:id/cancel — terminal transition from collecting,
// confirming, OR confirmed (game nights get called off after being finalized
// too). Unlike undo there is no way back: a cancelled proposal stays that
// way and a new proposal is created instead. If a play_sessions row exists
// it is deleted BEFORE the status flip, same delete-before-flip ordering as
// undo() — a cancelled-status proposal still owning a live session would be
// exactly the inconsistency that ordering avoids.
async cancel(proposalId: string, requestingUserId: string): Promise<PlaySessionProposal> {
  const proposal = await this.findProposalOrThrow(proposalId);
  await this.assertCanManageProposal(proposal, requestingUserId);

  if (proposal.status === 'cancelled') {
    throw new ConflictException('Proposal is already cancelled');
  }

  if (proposal.status === 'confirmed') {
    const session = await this.sessions.findOneBy({ proposalId: proposal.id });
    if (session) {
      await this.sessions.remove(session);
    }
  }

  proposal.status = 'cancelled';
  return this.proposals.save(proposal);
}
```

Note: `ConflictException` is already imported in the service file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @bggg/api -- scheduling.service`
Expected: PASS (all tests including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduling/
git commit -m "feat: add proposal cancellation endpoint"
```

---

### Task 2: CORS allows PUT

**Files:**
- Modify: `apps/api/src/main.ts:42`

**Interfaces:**
- Produces: cross-origin browser clients may now send PUT (RSVP + host endpoints).

- [ ] **Step 1: Edit the methods list**

In `apps/api/src/main.ts`, change line 42 from:

```ts
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
```

to:

```ts
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
```

- [ ] **Step 2: Verify nothing regressed**

Run: `npm test -w @bggg/api && npm run build -w @bggg/api`
Expected: all suites pass; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "fix: allow PUT method in CORS configuration"
```

---

### Task 3: Expose proposalGameId + votedByMe on games responses

The vote endpoints address the *join-row id* (`/proposals/:id/games/:proposalGameId/votes`), but the list responses only carried `{ game, voteCount }` — the UI cannot vote without this enrichment.

**Files:**
- Modify: `apps/api/src/scheduling/scheduling.service.ts` (listProposalGames + getProposal signatures)
- Test: `apps/api/src/scheduling/scheduling.service.spec.ts`

**Interfaces:**
- Produces (consumed by Task 11's web hook): both `listProposalGames` and `getProposal().games` now return
  `Array<{ proposalGameId: string; game: { id: number; name: string }; voteCount: number; votedByMe: boolean }>`.
  Exported type: `SchedulingService` file exports `interface ProposalGameWithVotes`.

- [ ] **Step 1: Update the spec first**

In `apps/api/src/scheduling/scheduling.service.spec.ts`:

Change the votes-repo mock declaration to include `existsBy`:

```ts
const mockGameVotes = { countBy: jest.fn(), existsBy: jest.fn() };
```

Rewrite the existing `getProposal` test body's fixture/expectations (keep the describe block):

```ts
it('should return the proposal, its rsvps, and its proposed games with vote counts', async () => {
  const proposal: PlaySessionProposal = {
    id: PROPOSAL_ID, groupId: GROUP_ID, createdBy: USER_ID, proposedDate: '2026-08-20',
    hostId: null, status: 'collecting', confirmedStart: null, confirmedEnd: null, createdAt: new Date(),
  };
  const rsvps: PlaySessionRsvp[] = [
    { id: 1, proposalId: PROPOSAL_ID, userId: USER_ID, status: 'yes', availableStart: null, availableEnd: null, confirmed: false, createdAt: new Date(), updatedAt: new Date() },
  ];
  const proposalGame: PlaySessionProposalGame = {
    id: 'pg-1', proposalId: PROPOSAL_ID, gameId: 42, proposedBy: USER_ID, createdAt: new Date(),
  };
  const game: Game = {
    id: 42, bggId: 174430, name: 'Gloomhaven', description: '', thumbnail: '', image: '',
    minPlayers: 1, maxPlayers: 4, playingTime: 120, yearPublished: 2017, rating: 8.79,
    lastFetchedAt: new Date(), createdAt: new Date(),
  };
  mockProposals.findOneBy.mockResolvedValue(proposal);
  mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
  mockRsvps.findBy.mockResolvedValue(rsvps);
  mockProposalGames.findBy.mockResolvedValue([proposalGame]);
  mockGames.findBy.mockResolvedValue([game]);
  mockGameVotes.countBy.mockResolvedValue(2);
  // The requesting user has NOT voted on this game.
  mockGameVotes.existsBy.mockResolvedValue(false);

  const result = await service.getProposal(PROPOSAL_ID, USER_ID);

  expect(result).toEqual({
    proposal,
    rsvps,
    games: [{
      proposalGameId: 'pg-1',
      game: { id: 42, name: 'Gloomhaven' },
      voteCount: 2,
      votedByMe: false,
    }],
  });
});

it('marks games the requesting user has already voted for as votedByMe', async () => {
  const proposal: PlaySessionProposal = {
    id: PROPOSAL_ID, groupId: GROUP_ID, createdBy: USER_ID, proposedDate: '2026-08-20',
    hostId: null, status: 'collecting', confirmedStart: null, confirmedEnd: null, createdAt: new Date(),
  };
  mockProposals.findOneBy.mockResolvedValue(proposal);
  mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
  mockProposalGames.findBy.mockResolvedValue([
    { id: 'pg-1', proposalId: PROPOSAL_ID, gameId: 42, proposedBy: USER_ID, createdAt: new Date() },
  ]);
  mockGames.findBy.mockResolvedValue([
    { id: 42, bggId: 174430, name: 'Gloomhaven', description: '', thumbnail: '', image: '',
      minPlayers: 1, maxPlayers: 4, playingTime: 120, yearPublished: 2017, rating: 8.79,
      lastFetchedAt: new Date(), createdAt: new Date() },
  ]);
  mockGameVotes.countBy.mockResolvedValue(3);
  mockGameVotes.existsBy.mockResolvedValue(true);

  const result = await service.listProposalGames(PROPOSAL_ID, USER_ID);

  expect(result).toEqual([{
    proposalGameId: 'pg-1',
    game: { id: 42, name: 'Gloomhaven' },
    voteCount: 3,
    votedByMe: true,
  }]);
});
```

Also assert the exact existsBy call shape once (append to the second test):

```ts
expect(mockGameVotes.existsBy).toHaveBeenCalledWith({ proposalGameId: 'pg-1', userId: USER_ID });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @bggg/api -- scheduling.service`
Expected: FAIL — missing `proposalGameId`/`votedByMe` in results.

- [ ] **Step 3: Implement**

In `apps/api/src/scheduling/scheduling.service.ts`, add above the class:

```ts
// One entry of GET /proposals/:id/games (and the games array inside
// GET /proposals/:id). proposalGameId is the join-row id the vote
// endpoints address; votedByMe lets the UI render the caller's own vote
// state without a second request.
export interface ProposalGameWithVotes {
  proposalGameId: string;
  game: { id: number; name: string };
  voteCount: number;
  votedByMe: boolean;
}
```

Change `listProposalGames` to:

```ts
async listProposalGames(
  proposalId: string,
  requestingUserId: string,
): Promise<ProposalGameWithVotes[]> {
  const proposal = await this.findProposalOrThrow(proposalId);
  await this.groupsService.findOne(proposal.groupId, requestingUserId);

  const proposalGames = await this.proposalGames.findBy({ proposalId });
  if (proposalGames.length === 0) return [];

  const gameEntities = await this.games.findBy({
    id: In(proposalGames.map((pg) => pg.gameId)),
  });
  const gameById = new Map(gameEntities.map((g) => [g.id, g]));

  return Promise.all(
    proposalGames.map(async (proposalGame) => ({
      proposalGameId: proposalGame.id,
      game: {
        id: proposalGame.gameId,
        name: gameById.get(proposalGame.gameId)?.name ?? 'Unknown game',
      },
      voteCount: await this.gameVotes.countBy({ proposalGameId: proposalGame.id }),
      votedByMe: await this.gameVotes.existsBy({
        proposalGameId: proposalGame.id,
        userId: requestingUserId,
      }),
    })),
  );
}
```

And update `getProposal`'s declared return type:

```ts
async getProposal(
  proposalId: string,
  requestingUserId: string,
): Promise<{
  proposal: PlaySessionProposal;
  rsvps: PlaySessionRsvp[];
  games: ProposalGameWithVotes[];
}> {
```

(body unchanged — it already delegates to `listProposalGames`.)

- [ ] **Step 4: Verify**

Run: `npm test -w @bggg/api && npm run build -w @bggg/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduling/
git commit -m "feat: expose proposalGameId and votedByMe on proposal games responses"
```

---

### Task 4: Include group role in members response

The panel needs the caller's role ("owner"/"admin"/"member") to decide which lifecycle controls to render.

**Files:**
- Modify: `apps/api/src/groups/groups.service.ts` (getMembers)
- Test: `apps/api/src/groups/groups.service.spec.ts`

**Interfaces:**
- Produces: `GET /groups/:groupId/members` items become `{ id: string; displayName: string; role: 'owner'|'admin'|'member' }` (KeycloakUserInfo spread + role).

- [ ] **Step 1: Update the spec first**

In `apps/api/src/groups/groups.service.spec.ts`, rewrite the happy-path getMembers test expectations:

```ts
it('should return display names AND group roles for every member, after checking access', async () => {
  const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
  mockRepository.findOneBy.mockResolvedValue(group);
  mockMembersRepository.findOneBy.mockResolvedValue({
    id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'owner', joinedAt: new Date(),
  });
  mockMembersRepository.findBy.mockResolvedValue([
    { id: 1, userId: 'user-a', groupId: 'group-1', role: 'owner', joinedAt: new Date() },
    { id: 2, userId: 'user-b', groupId: 'group-1', role: 'member', joinedAt: new Date() },
  ]);
  mockKeycloakAdmin.getUser
    .mockResolvedValueOnce({ id: 'user-a', displayName: 'Alice' })
    .mockResolvedValueOnce({ id: 'user-b', displayName: 'Bob' });

  const result = await service.getMembers('group-1', OWNER_ID);

  expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: 'group-1' });
  expect(result).toEqual([
    { id: 'user-a', displayName: 'Alice', role: 'owner' },
    { id: 'user-b', displayName: 'Bob', role: 'member' },
  ]);
});
```

(The ForbiddenException getMembers test below it stays unchanged.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @bggg/api -- groups.service`
Expected: FAIL — result lacks `role`.

- [ ] **Step 3: Implement**

In `apps/api/src/groups/groups.service.ts`, change `getMembers`:

```ts
// Reuses findOne's existing 404-vs-403 access check — same "look but
// don't touch" read access every role gets, no stricter check needed
// since this is read-only. Each member's group_members.role rides along
// on the response so clients can gate management UI on it without an
// extra endpoint.
async getMembers(
  id: string,
  requestingUserId: string,
): Promise<Array<KeycloakUserInfo & { role: string }>> {
  await this.findOne(id, requestingUserId);

  const memberships = await this.members.findBy({ groupId: id });
  return Promise.all(
    memberships.map(async (m) => ({
      ...(await this.keycloakAdmin.getUser(m.userId)),
      role: m.role,
    })),
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm test -w @bggg/api && npm run build -w @bggg/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/groups/
git commit -m "feat: include group role in members response"
```

---

### Task 5: Group library endpoint (GET /groups/:groupId/games)

**Files:**
- Modify: `apps/api/src/groups/groups.module.ts`
- Modify: `apps/api/src/groups/groups.service.ts`
- Modify: `apps/api/src/groups/groups.controller.ts`
- Test: `apps/api/src/groups/groups.service.spec.ts`

**Interfaces:**
- Consumes: `GameOwnership` entity (`../collections/game-ownership.entity`, columns userId/gameId), `Game` entity.
- Produces: `GroupsService.getLibrary(groupId: string, requestingUserId: string): Promise<Array<Pick<Game, 'id' | 'bggId' | 'name' | 'thumbnail' | 'minPlayers' | 'maxPlayers'>>>` — deduped union across all members, ordered by name.

- [ ] **Step 1: Write failing tests**

In `apps/api/src/groups/groups.service.spec.ts`:

Add imports:

```ts
import { GameOwnership } from '../collections/game-ownership.entity';
import { Game } from '../games/game.entity';
```

Add two repo mocks next to the existing ones:

```ts
const mockOwnershipRepository = {
  findBy: jest.fn(),
};

const mockGamesRepository = {
  find: jest.fn(),
};
```

Register them in the testing module's providers array (after the GroupMember provider):

```ts
{
  provide: getRepositoryToken(GameOwnership),
  useValue: mockOwnershipRepository,
},
{
  provide: getRepositoryToken(Game),
  useValue: mockGamesRepository,
},
```

Add the describe block:

```ts
// ── getLibrary ───────────────────────────────────────────────────────────

describe('getLibrary', () => {
  const gameFixture = (id: number, name: string): Game => ({
    id, bggId: 1000 + id, name, description: '', thumbnail: `t-${id}.jpg`, image: '',
    minPlayers: 2, maxPlayers: 4, playingTime: 90, yearPublished: 2015, rating: 7.5,
    lastFetchedAt: new Date(), createdAt: new Date(),
  });

  it('returns the deduplicated union of all members owned games, sorted by name', async () => {
    const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
    mockRepository.findOneBy.mockResolvedValue(group);
    mockMembersRepository.findOneBy.mockResolvedValue({
      id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'member', joinedAt: new Date(),
    });
    mockMembersRepository.findBy.mockResolvedValue([
      { id: 1, userId: 'user-a', groupId: 'group-1', role: 'owner', joinedAt: new Date() },
      { id: 2, userId: 'user-b', groupId: 'group-1', role: 'member', joinedAt: new Date() },
    ]);
    // Both users own game 42 — the union must contain it ONCE.
    mockOwnershipRepository.findBy.mockResolvedValue([
      { id: 1, userId: 'user-a', gameId: 42, addedAt: new Date() },
      { id: 2, userId: 'user-a', gameId: 7, addedAt: new Date() },
      { id: 3, userId: 'user-b', gameId: 42, addedAt: new Date() },
    ]);
    mockGamesRepository.find.mockResolvedValue([gameFixture(7, 'Azul'), gameFixture(42, 'Gloomhaven')]);

    const result = await service.getLibrary('group-1', 'user-b');

    expect(result).toEqual([
      { id: 7, bggId: 1007, name: 'Azul', thumbnail: 't-7.jpg', minPlayers: 2, maxPlayers: 4 },
      { id: 42, bggId: 1042, name: 'Gloomhaven', thumbnail: 't-42.jpg', minPlayers: 2, maxPlayers: 4 },
    ]);
  });

  it('returns an empty array when no member owns anything', async () => {
    const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
    mockRepository.findOneBy.mockResolvedValue(group);
    // Requester membership for findOne's access check:
    mockMembersRepository.findOneBy.mockResolvedValue({
      id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'owner', joinedAt: new Date(),
    });
    mockMembersRepository.findBy.mockResolvedValue([]);
    mockOwnershipRepository.findBy.mockResolvedValue([]);

    const result = await service.getLibrary('group-1', OWNER_ID);

    expect(result).toEqual([]);
    expect(mockGamesRepository.find).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @bggg/api -- groups.service`
Expected: FAIL — `service.getLibrary is not a function` (and module compile error until repos registered — Step 3 fixes both).

- [ ] **Step 3: Implement**

`apps/api/src/groups/groups.module.ts` — change the forFeature line and add imports:

```ts
import { GameOwnership } from '../collections/game-ownership.entity';
import { Game } from '../games/game.entity';
```

```ts
imports: [
  TypeOrmModule.forFeature([Group, GroupMember, GameOwnership, Game]),
  AuditModule,
  KeycloakModule,
],
```

`apps/api/src/groups/groups.service.ts` — add imports:

```ts
import { GameOwnership } from '../collections/game-ownership.entity';
import { Game } from '../games/game.entity';
```

Add constructor params (after `members`):

```ts
// The group game library is the union of members' game_ownership rows —
// same "each module registers its own repository for a shared entity"
// pattern SchedulingModule uses for GroupMember.
@InjectRepository(GameOwnership)
private readonly ownership: Repository<GameOwnership>,
@InjectRepository(Game)
private readonly gamesRepo: Repository<Game>,
```

Add the method after `getMembers`:

```ts
// GET /groups/:groupId/games — every game owned by ANY member, deduped,
// sorted by name. This is the data source for the propose-a-game picker
// on proposals. Read-only, so plain membership (any role) suffices —
// same access level as getMembers.
async getLibrary(
  id: string,
  requestingUserId: string,
): Promise<Array<Pick<Game, 'id' | 'bggId' | 'name' | 'thumbnail' | 'minPlayers' | 'maxPlayers'>>> {
  await this.findOne(id, requestingUserId);

  const memberships = await this.members.findBy({ groupId: id });
  if (memberships.length === 0) return [];

  const ownerships = await this.ownership.findBy({
    userId: In(memberships.map((m) => m.userId)),
  });
  if (ownerships.length === 0) return [];

  // Set-dedupe here, not via DISTINCT SQL — ownership rows per user are
  // already unique on (user_id, game_id), so duplicates only arise ACROSS
  // users, which this collapse handles in one place.
  const gameIds = [...new Set(ownerships.map((o) => o.gameId))];

  const games = await this.gamesRepo.find({
    where: { id: In(gameIds) },
    order: { name: 'ASC' },
  });

  return games.map((g) => ({
    id: g.id,
    bggId: g.bggId,
    name: g.name,
    thumbnail: g.thumbnail,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
  }));
}
```

`apps/api/src/groups/groups.controller.ts` — add route after `getMembers`:

```ts
// GET /groups/:groupId/games → the group's game library: union of all
// members' owned games (see GroupsService.getLibrary).
@Get(':groupId/games')
getLibrary(
  @Param('groupId', ParseUUIDPipe) groupId: string,
  @Request() req: AuthenticatedRequest,
) {
  return this.groupsService.getLibrary(groupId, req.user.sub);
}
```

- [ ] **Step 4: Verify**

Run: `npm test -w @bggg/api && npm run build -w @bggg/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/groups/
git commit -m "feat: add group library endpoint"
```

---

### Task 6: Web foundation — session user id, apiMutate, types

**Files:**
- Modify: `apps/web/auth.ts`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/lib/types.ts`

**Interfaces:**
- Produces:
  - `session.user?.id` = Keycloak sub (string), available to client components via `useSession()`.
  - `class ApiError extends Error { readonly status: number }` and
    `apiMutate(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<Response>`
    in `lib/api.ts` — throws `ApiError` on non-ok.
  - Types in `lib/types.ts`: `MemberRole`, updated `GroupMemberInfo` (+ `role`), updated `ProposalGameSummary` (+ `proposalGameId`, `votedByMe`), new `RsvpInput`, `GroupLibraryGame`.

- [ ] **Step 1: auth.ts — expose the Keycloak sub on the session**

In `apps/web/auth.ts`, change the session callback:

```ts
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.error = token.error as 'RefreshTokenError' | undefined;
      // token.sub is the Keycloak user id — NextAuth copies it off the ID
      // token at sign-in and preserves it through refreshes. Exposing it
      // here lets client components gate controls on "is this mine / what's
      // my role" without decoding the access token in the browser.
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
```

Auth.js v5's default `User` type already carries `id?: string`, so this typechecks without further augmentation. IF `npm run build` later rejects `.id`, add `DefaultSession` to the next-auth import and merge `{ id?: string }` into the Session interface's user type in the existing `declare module 'next-auth'` block.

- [ ] **Step 2: lib/api.ts — apiMutate**

Append to `apps/web/lib/api.ts` (keeping `apiFetch` untouched):

```ts
// Thrown by apiMutate for any non-ok response. NestJS error bodies look
// like { statusCode, message, error } — message is the human-readable part
// (e.g. 'RSVPs are closed once confirmation has been requested') and is
// what components surface inline.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Mutation funnel for scheduling (Approach A: plain fetch + refetch —
// deliberately NOT a data-fetching library; if caching or optimistic
// updates are ever needed, TanStack Query wraps around these same paths
// without backend changes).
//
// Throws ApiError on !ok so callers render `err.message` directly; returns
// the raw Response otherwise (callers read JSON themselves when they need
// the created/updated resource back).
export async function apiMutate(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<Response> {
  const response = await apiFetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      if (typeof data?.message === 'string') message = data.message;
    } catch {
      // Non-JSON error body — statusText is the best we have.
    }
    throw new ApiError(message, response.status);
  }

  return response;
}
```

- [ ] **Step 3: lib/types.ts — scheduling interaction types**

Apply these edits to `apps/web/lib/types.ts`:

Replace `GroupMemberInfo` and add `MemberRole`:

```ts
export type MemberRole = 'owner' | 'admin' | 'member';

// Mirrors apps/api getMembers: Keycloak display info + the member's
// group_members.role, which drives which lifecycle controls the panel shows.
export interface GroupMemberInfo {
  id: string;
  displayName: string;
  role: MemberRole;
}
```

Replace `ProposalGameSummary`:

```ts
export interface ProposalGameSummary {
  proposalGameId: string;
  game: { id: number; name: string };
  voteCount: number;
  votedByMe: boolean;
}
```

Add at the end of the file:

```ts
// Body of PUT /proposals/:id/rsvp. Times are optional HH:mm (24h) —
// omitted means the server applies the Decision G default window
// (10:00–02:00 next day) anchored to the proposal's date.
export interface RsvpInput {
  status: Rsvp['status'];
  availableStart?: string;
  availableEnd?: string;
}

// One row of GET /groups/:groupId/games — the propose-a-game picker's data.
export interface GroupLibraryGame {
  id: number;
  bggId: number;
  name: string;
  thumbnail: string | null;
  minPlayers: number;
  maxPlayers: number;
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint -w @bggg/web && npm run build -w @bggg/web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/auth.ts apps/web/lib/api.ts apps/web/lib/types.ts
git commit -m "feat: expose keycloak sub on session, add apiMutate and scheduling types"
```

---

### Task 7: Monday-first month grid with weekday initials

**Files:**
- Modify: `apps/web/lib/calendar-grid.ts`
- Modify: `apps/web/components/calendar-month-grid.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildMonthGrid` weeks now run Mon→Sun; grid renders an `M T W T F S S` header row. Badge behavior unchanged.

- [ ] **Step 1: calendar-grid.ts — change the week anchor**

In `apps/web/lib/calendar-grid.ts`, replace the header comment and offset lines of `buildMonthGrid`:

```ts
// Builds a full 7-column grid (Mon-Sun) for the month containing
// `monthAnchor`, including the leading/trailing days from adjacent months
// needed to fill complete weeks.
export function buildMonthGrid(monthAnchor: Date): CalendarDay[] {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // JS getDay(): 0=Sunday..6=Saturday. Rebased to Monday-first by folding
  // the weekend around: Sunday(0) becomes 6, Monday(1) stays 0.
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
```

(the rest of the function is unchanged)

- [ ] **Step 2: calendar-month-grid.tsx — weekday initials header**

In `apps/web/components/calendar-month-grid.tsx`, add below the `MAX_BADGES_PER_DAY` constant:

```ts
// Column labels for the Monday-first grid — one initial per weekday,
// left to right Mon..Sun.
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
```

Inside the JSX, insert between the month-navigation `</div>` (the one closing the prev/next/today bar) and the existing days `<div className="grid grid-cols-7 gap-1">`:

```tsx
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAY_INITIALS.map((initial) => (
          <div key={initial} className="text-center text-xs font-medium text-text-muted">
            {initial}
          </div>
        ))}
      </div>
```

- [ ] **Step 3: Verify**

Run: `npm run lint -w @bggg/web && npm run build -w @bggg/web`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/calendar-grid.ts apps/web/components/calendar-month-grid.tsx
git commit -m "feat: monday-first month grid with weekday initials"
```

---

### Task 8: Proposal actions hook + lifecycle strip + cancelled banner

**Files:**
- Create: `apps/web/hooks/use-proposal-actions.ts`
- Create: `apps/web/components/proposal-lifecycle-actions.tsx`
- Modify: `apps/web/components/proposal-detail-panel.tsx`

**Interfaces:**
- Consumes: `apiMutate`, `ApiError`, `Proposal`, `useSession` (next-auth/react), `useGroupMembers` (now carrying `role`).
- Produces:
  - `useProposalActions(onChanged?: () => void)` returning
    `{ pendingAction: string | null; error: string | null; clearError(): void; rsvp(id, input: RsvpInput): Promise<void>; lockIn(id, confirmed: boolean): Promise<void>; requestConfirmation(id): Promise<void>; finalize(id): Promise<void>; undo(id): Promise<void>; cancel(id): Promise<void>; setHost(id, userId): Promise<void>; clearHost(id): Promise<void> }`.
    Every action: runs, and on success calls `onChanged` (which callers wire to detail refetch + list refresh). Failures store `error` and resolve (never reject) — components render `error` inline.
  - `ProposalLifecycleActions` component props: `{ proposal: Proposal; canManage: boolean; actions: ReturnType<typeof useProposalActions> }`.

- [ ] **Step 1: Create the actions hook**

Create `apps/web/hooks/use-proposal-actions.ts`:

```ts
'use client';

import { useCallback, useState } from 'react';
import { ApiError, apiMutate } from '@/lib/api';
import type { RsvpInput } from '@/lib/types';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message === 'Session expired') return err.message;
  return 'Something went wrong — try again';
}

// One shared pending/error channel for every proposal mutation: only one
// action is ever in flight (buttons disable while pendingAction is set),
// and the failed action's message renders inline where the buttons live.
// Each action resolves even on failure — callers don't try/catch, they
// read `error`.
export function useProposalActions(onChanged?: () => void) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setPendingAction(key);
      setError(null);
      try {
        await action();
        onChanged?.();
      } catch (err) {
        setError(messageFor(err));
      } finally {
        setPendingAction(null);
      }
    },
    [onChanged],
  );

  const rsvp = useCallback(
    (proposalId: string, input: RsvpInput) =>
      run('rsvp', () => apiMutate(`/proposals/${proposalId}/rsvp`, 'PUT', input)),
    [run],
  );
  const lockIn = useCallback(
    (proposalId: string, confirmed: boolean) =>
      run('lock-in', () =>
        apiMutate(`/proposals/${proposalId}/rsvp/lock-in`, 'PATCH', { confirmed }),
      ),
    [run],
  );
  const requestConfirmation = useCallback(
    (proposalId: string) =>
      run('request-confirmation', () =>
        apiMutate(`/proposals/${proposalId}/request-confirmation`, 'POST'),
      ),
    [run],
  );
  const finalize = useCallback(
    (proposalId: string) => run('finalize', () => apiMutate(`/proposals/${proposalId}/finalize`, 'POST')),
    [run],
  );
  const undo = useCallback(
    (proposalId: string) => run('undo', () => apiMutate(`/proposals/${proposalId}/undo`, 'POST')),
    [run],
  );
  const cancel = useCallback(
    (proposalId: string) => run('cancel', () => apiMutate(`/proposals/${proposalId}/cancel`, 'POST')),
    [run],
  );
  const setHost = useCallback(
    (proposalId: string, userId: string) =>
      run('set-host', () => apiMutate(`/proposals/${proposalId}/host`, 'PUT', { userId })),
    [run],
  );
  const clearHost = useCallback(
    (proposalId: string) =>
      run('clear-host', () => apiMutate(`/proposals/${proposalId}/host`, 'DELETE')),
    [run],
  );

  return {
    pendingAction,
    error,
    clearError: () => setError(null),
    rsvp,
    lockIn,
    requestConfirmation,
    finalize,
    undo,
    cancel,
    setHost,
    clearHost,
  };
}

export type ProposalActions = ReturnType<typeof useProposalActions>;
```

- [ ] **Step 2: Create the lifecycle strip component**

Create `apps/web/components/proposal-lifecycle-actions.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { Proposal } from '@/lib/types';
import type { ProposalActions } from '@/hooks/use-proposal-actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

interface ProposalLifecycleActionsProps {
  proposal: Proposal;
  canManage: boolean;
  actions: ProposalActions;
}

// Creator / owner-admin lifecycle controls, contextual to the current
// status. Undo from 'confirmed' also deletes the recorded play_sessions
// row server-side, so it gets the same confirmation dialog as cancel.
export function ProposalLifecycleActions({ proposal, canManage, actions }: ProposalLifecycleActionsProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const busy = actions.pendingAction !== null;

  if (!canManage || proposal.status === 'cancelled') return null;

  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
      {proposal.status === 'collecting' && (
        <>
          <Button
            type="button"
            disabled={busy}
            onClick={() => actions.requestConfirmation(proposal.id)}
          >
            Request confirmation
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(true)}>
            Cancel proposal
          </Button>
        </>
      )}
      {proposal.status === 'confirming' && (
        <>
          <Button type="button" disabled={busy} onClick={() => actions.finalize(proposal.id)}>
            Finalize
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => actions.undo(proposal.id)}>
            Undo
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(true)}>
            Cancel proposal
          </Button>
        </>
      )}
      {proposal.status === 'confirmed' && (
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmingUndo(true)}>
            Undo confirmation
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(true)}>
            Cancel session
          </Button>
        </>
      )}

      <Dialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Cancel this proposal?</DialogTitle>
          <p className="mt-2 text-sm text-text-muted">
            Everyone will see it was cancelled. This cannot be undone — create a new proposal instead.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmingCancel(false);
                void actions.cancel(proposal.id);
              }}
            >
              Yes, cancel it
            </Button>
            <DialogClose className="text-sm text-text-muted underline">Keep it</DialogClose>
          </div>
        </DialogSheetContent>
      </Dialog>

      <Dialog open={confirmingUndo} onOpenChange={setConfirmingUndo}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Undo this confirmed session?</DialogTitle>
          <p className="mt-2 text-sm text-text-muted">
            The recorded session is deleted and the proposal returns to collecting RSVPs.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConfirmingUndo(false);
                void actions.undo(proposal.id);
              }}
            >
              Undo it
            </Button>
            <DialogClose className="text-sm text-text-muted underline">Keep it</DialogClose>
          </div>
        </DialogSheetContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Wire gating + banner into the panel**

In `apps/web/components/proposal-detail-panel.tsx`:

Add imports:

```tsx
import { useSession } from 'next-auth/react';
import { useProposalActions } from '@/hooks/use-proposal-actions';
import { ProposalLifecycleActions } from '@/components/proposal-lifecycle-actions';
```

Change the component opening (props gain `onChanged`, hook wiring, derived flags):

```tsx
interface ProposalDetailPanelProps {
  proposalId: string | null;
  onClose: () => void;
  /** Called after any successful mutation — parents refresh their lists here. */
  onChanged?: () => void;
}

export function ProposalDetailPanel({ proposalId, onClose, onChanged }: ProposalDetailPanelProps) {
  const { detail, loading, notFound, error, retry } = useProposalDetail(proposalId);
  const members = useGroupMembers(detail?.proposal.groupId ?? null);
  const { data: session } = useSession();
  // onChanged fires after EVERY successful action; the panel refetches its
  // own detail here, and the parent bumps its proposal-list refreshKey.
  const actions = useProposalActions(() => {
    retry();
    onChanged?.();
  });

  const myId = session?.user?.id ?? null;
  const myRole = myId ? members.find((m) => m.id === myId)?.role : undefined;
  const canManage =
    !!detail &&
    ((myId !== null && detail.proposal.createdBy === myId) ||
      myRole === 'owner' ||
      myRole === 'admin');
```

Inside the `detail && (...)` block: wrap the whole content in a conditional — when `detail.proposal.status === 'cancelled'` render ONLY a muted banner instead of the sections:

```tsx
{detail && detail.proposal.status === 'cancelled' ? (
  <p className="rounded-sm bg-surface p-3 text-sm text-text-muted">
    This proposal was cancelled.
  </p>
) : (
  detail && (
    <div className="space-y-3 font-body text-sm">
      {/* ...existing header/RSVP/games markup unchanged in this task... */}
      <ProposalLifecycleActions proposal={detail.proposal} canManage={canManage} actions={actions} />
    </div>
  )
)}
```

And render the shared action-error line just under the loading/notFound/error block:

```tsx
{actions.error && <p className="text-accent">{actions.error}</p>}
```

Callers (both calendar views) pass `onChanged` in Task 12 — until then the prop is optional and unused.

- [ ] **Step 4: Verify**

Run: `npm run lint -w @bggg/web && npm run build -w @bggg/web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/hooks/use-proposal-actions.ts apps/web/components/proposal-lifecycle-actions.tsx apps/web/components/proposal-detail-panel.tsx
git commit -m "feat: proposal actions hook and lifecycle controls"
```

---

### Task 9: RSVP section — yes/maybe/no + optional hours + lock-in

**Files:**
- Create: `apps/web/lib/datetime.ts`
- Create: `apps/web/components/proposal-rsvp-section.tsx`
- Modify: `apps/web/components/proposal-detail-panel.tsx`

**Interfaces:**
- Produces:
  - `hhmm(iso: string): string` and `formatWindowRange(startIso: string | null, endIso: string | null): string` in `lib/datetime.ts`.
  - `ProposalRsvpSection` props: `{ proposalId: string; proposalStatus: Proposal['status']; myRsvp: Rsvp | undefined; actions: ProposalActions }`.

- [ ] **Step 1: datetime helpers**

Create `apps/web/lib/datetime.ts`:

```ts
// "HH:mm" (24h) of an ISO timestamp in the viewer's local time — the shape
// the API's rsvp DTO expects back and the RSVP inputs are keyed in.
export function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "Sat 30 Aug, 18:00 – 23:00" — used for the stored/confirmed window shown
// while confirming and after finalizing.
export function formatWindowRange(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '';
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const from = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const to = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${from} – ${to}`;
}
```

- [ ] **Step 2: RSVP section component**

Create `apps/web/components/proposal-rsvp-section.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { Proposal, Rsvp } from '@/lib/types';
import type { ProposalActions } from '@/hooks/use-proposal-actions';
import { hhmm, formatWindowRange } from '@/lib/datetime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ProposalRsvpSectionProps {
  proposalId: string;
  proposalStatus: Proposal['status'];
  myRsvp: Rsvp | undefined;
  actions: ProposalActions;
}

const ANSWERS = ['yes', 'maybe', 'no'] as const;

// Member-facing answer controls. Collecting: three one-click answers
// (empty window = server-side Decision G default). An optional disclosure
// lets people pin exact hours instead. Confirming: answers are closed —
// yes/maybe holders see the stored window and a lock-in toggle instead.
export function ProposalRsvpSection({ proposalId, proposalStatus, myRsvp, actions }: ProposalRsvpSectionProps) {
  const busy = actions.pendingAction !== null;
  const [hoursOpen, setHoursOpen] = useState(false);
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');

  // Pre-fill the hour fields from the saved RSVP whenever it changes.
  useEffect(() => {
    setStartInput(myRsvp?.availableStart ? hhmm(myRsvp.availableStart) : '');
    setEndInput(myRsvp?.availableEnd ? hhmm(myRsvp.availableEnd) : '');
  }, [myRsvp]);

  if (proposalStatus === 'cancelled') return null;

  if (proposalStatus === 'confirming' || proposalStatus === 'confirmed') {
    const window = formatWindowRange(myRsvp?.availableStart ?? null, myRsvp?.availableEnd ?? null);
    return (
      <div className="border-t border-border pt-3">
        <div className="font-medium">Your answer</div>
        <p className="mt-1 text-text-muted">
          {myRsvp ? (
            <>
              {myRsvp.status.toUpperCase()}
              {window && <> — {window}</>}
              {myRsvp.confirmed && (
                <Badge className="ml-2">Locked in</Badge>
              )}
            </>
          ) : (
            'You did not answer'
          )}
        </p>
        {proposalStatus === 'confirming' && myRsvp && myRsvp.status !== 'no' && (
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            disabled={busy}
            onClick={() => void actions.lockIn(proposalId, !myRsvp.confirmed)}
          >
            {myRsvp.confirmed ? 'Withdraw lock-in' : 'Lock in'}
          </Button>
        )}
      </div>
    );
  }

  // status === 'collecting'
  async function saveHours(nextStatus: Rsvp['status']) {
    // Both filled → explicit hours; both cleared → back to the default
    // window (fields omitted). Mixed input is refused client-side because
    // the API treats each field independently.
    if (!!startInput !== !!endInput) return;
    await actions.rsvp(proposalId, {
      status: nextStatus,
      ...(startInput && endInput ? { availableStart: startInput, availableEnd: endInput } : {}),
    });
    setHoursOpen(false);
  }

  return (
    <div className="border-t border-border pt-3">
      <div className="font-medium">Your answer</div>
      <div className="mt-2 flex gap-2">
        {ANSWERS.map((answer) => (
          <Button
            key={answer}
            type="button"
            variant={myRsvp?.status === answer ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => void actions.rsvp(proposalId, { status: answer })}
          >
            {answer[0].toUpperCase() + answer.slice(1)}
          </Button>
        ))}
      </div>

      {(myRsvp?.status ?? 'yes') !== 'no' && (
        <div className="mt-2">
          <button
            type="button"
            className="text-xs text-text-muted underline"
            onClick={() => setHoursOpen((open) => !open)}
          >
            {hoursOpen ? 'Hide hours' : 'Specify hours'}
          </button>
          {hoursOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <input
                type="time"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                aria-label="Available from"
              />
              <span>–</span>
              <input
                type="time"
                value={endInput}
                onChange={(e) => setEndInput(e.target.value)}
                aria-label="Available until"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={
                  busy ||
                  (!!startInput !== !!endInput) ||
                  (!startInput && !endInput &&
                    !myRsvp?.availableStart && !myRsvp?.availableEnd)
                }
                onClick={() => void saveHours(myRsvp?.status ?? 'yes')}
              >
                Save hours
              </Button>
              {!myRsvp && <span className="text-xs text-text-muted">(saves your answer as Yes)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount in the panel**

In `apps/web/components/proposal-detail-panel.tsx`, add import:

```tsx
import { ProposalRsvpSection } from '@/components/proposal-rsvp-section';
```

Inside the non-cancelled branch, directly after the header info `<div>` (date/status/proposer/host) and before the RSVPs list, mount:

```tsx
<ProposalRsvpSection
  proposalId={detail.proposal.id}
  proposalStatus={detail.proposal.status}
  myRsvp={detail.rsvps.find((r) => r.userId === myId)}
  actions={actions}
/>
```

- [ ] **Step 4: Verify**

Run: `npm run lint -w @bggg/web && npm run build -w @bggg/web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/datetime.ts apps/web/components/proposal-rsvp-section.tsx apps/web/components/proposal-detail-panel.tsx
git commit -m "feat: rsvp controls with availability hours and lock-in"
```

---

### Task 10: Host designation controls

**Files:**
- Modify: `apps/web/components/proposal-detail-panel.tsx`

**Interfaces:**
- Consumes: `actions.setHost(id, userId)` / `actions.clearHost(id)` from Task 8; `canManage` flag; `nameFor(userId)` helper already in the panel.

- [ ] **Step 1: Extend the RSVP list rows**

In `apps/web/components/proposal-detail-panel.tsx`, replace the RSVPs `<ul>` block with:

```tsx
<div>
  <div className="font-medium">RSVPs</div>
  <ul>
    {detail.rsvps.map((rsvp) => {
      const isHost = detail.proposal.hostId === rsvp.userId;
      const canMakeHost =
        canManage &&
        detail.proposal.status !== 'cancelled' &&
        rsvp.status === 'yes';
      return (
        <li key={rsvp.userId} className="flex items-center gap-2">
          <span>{nameFor(rsvp.userId)} — {rsvp.status}</span>
          {isHost && <Badge>Host</Badge>}
          {canManage && rsvp.confirmed && <Badge>Locked in</Badge>}
          {canMakeHost && !isHost && (
            <button
              type="button"
              className="text-xs text-text-muted underline"
              disabled={actions.pendingAction !== null}
              onClick={() => void actions.setHost(detail.proposal.id, rsvp.userId)}
            >
              Make host
            </button>
          )}
          {canManage && isHost && detail.proposal.status !== 'cancelled' && (
            <button
              type="button"
              className="text-xs text-text-muted underline"
              disabled={actions.pendingAction !== null}
              onClick={() => void actions.clearHost(detail.proposal.id)}
            >
              Clear host
            </button>
          )}
        </li>
      );
    })}
  </ul>
</div>
```

- [ ] **Step 2: Verify**

Run: `npm run lint -w @bggg/web && npm run build -w @bggg/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/proposal-detail-panel.tsx
git commit -m "feat: host designation controls in proposal panel"
```

---

### Task 11: Games section — voting + group-library picker

**Files:**
- Create: `apps/web/hooks/use-proposal-games.ts`
- Create: `apps/web/hooks/use-group-library.ts`
- Create: `apps/web/components/proposal-games-section.tsx`
- Modify: `apps/web/components/proposal-detail-panel.tsx`

**Interfaces:**
- Consumes: enriched games response (Task 3): `GET /proposals/:id/games` → `Array<{ proposalGameId; game; voteCount; votedByMe }>`; library (Task 5): `GET /groups/:groupId/games`.
- Produces:
  - `useProposalGames(proposalId: string | null, onChanged?: () => void)` → `{ rows: ProposalGameSummary[]; loading: boolean; error: string | null; pendingAction: string | null; actionError: string | null; proposeGame(gameId: number): Promise<void>; vote(pgId: string): Promise<void>; unvote(pgId: string): Promise<void>; reload(): void }`.
  - `useGroupLibrary(groupId: string | null)` → `{ games: GroupLibraryGame[]; loading: boolean; error: string | null; reload(): void }`.
  - `ProposalGamesSection` props: `{ proposalId: string; groupId: string; onChanged?: () => void }`.

- [ ] **Step 1: use-group-library hook**

Create `apps/web/hooks/use-group-library.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { GroupLibraryGame } from '@/lib/types';

interface UseGroupLibraryResult {
  games: GroupLibraryGame[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useGroupLibrary(groupId: string | null): UseGroupLibraryResult {
  const [games, setGames] = useState<GroupLibraryGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!groupId) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manual fetch-in-effect (see use-proposals.ts); resets must land synchronously with the fetch start.
    setLoading(true);
    setError(null);

    apiFetch(`/groups/${groupId}/games`)
      .then((res) => {
        if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
        return res.json();
      })
      .then((data: GroupLibraryGame[]) => {
        if (!cancelled) setGames(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the group game library');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [groupId, refreshKey]);

  return {
    games,
    loading,
    error,
    reload: () => setRefreshKey((k) => k + 1),
  };
}
```

- [ ] **Step 2: use-proposal-games hook**

Create `apps/web/hooks/use-proposal-games.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch, apiMutate } from '@/lib/api';
import type { ProposalGameSummary } from '@/lib/types';

interface UseProposalGamesResult {
  rows: ProposalGameSummary[];
  loading: boolean;
  error: string | null;
  pendingAction: string | null;
  actionError: string | null;
  proposeGame: (gameId: number) => Promise<void>;
  vote: (proposalGameId: string) => Promise<void>;
  unvote: (proposalGameId: string) => Promise<void>;
  reload: () => void;
}

// Own fetch of the games list (rather than reading detail.games) keeps this
// hook independently refreshable — voting bumps only this list's data.
// Same shared pending/error channel design as use-proposal-actions.
export function useProposalGames(proposalId: string | null, onChanged?: () => void): UseProposalGamesResult {
  const [rows, setRows] = useState<ProposalGameSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!proposalId) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manual fetch-in-effect (see use-proposals.ts).
    setLoading(true);
    setError(null);

    apiFetch(`/proposals/${proposalId}/games`)
      .then((res) => {
        if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
        return res.json();
      })
      .then((data: ProposalGameSummary[]) => {
        if (!cancelled) setRows(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load proposed games');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [proposalId, refreshKey]);

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setPendingAction(key);
      setActionError(null);
      try {
        await action();
        setRefreshKey((k) => k + 1);
        onChanged?.();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong — try again');
      } finally {
        setPendingAction(null);
      }
    },
    [onChanged],
  );

  const proposeGame = useCallback(
    (gameId: number) => run('propose', () => apiMutate(`/proposals/${proposalId}/games`, 'POST', { gameId })),
    [run, proposalId],
  );
  const vote = useCallback(
    (pgId: string) => run(`vote:${pgId}`, () => apiMutate(`/proposals/${proposalId}/games/${pgId}/votes`, 'POST')),
    [run, proposalId],
  );
  const unvote = useCallback(
    (pgId: string) => run(`unvote:${pgId}`, () => apiMutate(`/proposals/${proposalId}/games/${pgId}/votes`, 'DELETE')),
    [run, proposalId],
  );

  return {
    rows,
    loading,
    error,
    pendingAction,
    actionError,
    proposeGame,
    vote,
    unvote,
    reload: () => setRefreshKey((k) => k + 1),
  };
}
```

- [ ] **Step 3: Games section component with picker dialog**

Create `apps/web/components/proposal-games-section.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import type { ProposalStatus } from '@/lib/types';
import { useProposalGames } from '@/hooks/use-proposal-games';
import { useGroupLibrary } from '@/hooks/use-group-library';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

interface ProposalGamesSectionProps {
  proposalId: string;
  groupId: string;
  proposalStatus: ProposalStatus;
  onChanged?: () => void;
}

// Proposed-game poll: upvote toggles against the derived count, plus an
// Add-game picker fed by the group library (client-side name filter — the
// endpoint takes no query params).
export function ProposalGamesSection({ proposalId, groupId, proposalStatus, onChanged }: ProposalGamesSectionProps) {
  const games = useProposalGames(proposalId, onChanged);
  const library = useGroupLibrary(groupId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return library.games;
    return library.games.filter((g) => g.name.toLowerCase().includes(q));
  }, [library.games, filter]);

  const busy = games.pendingAction !== null;

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">Suggested games</div>
        {proposalStatus === 'collecting' && (
          <Button type="button" variant="secondary" className="px-2 py-1 text-xs" disabled={busy} onClick={() => setPickerOpen(true)}>
            Add game
          </Button>
        )}
      </div>

      {games.loading && <p className="mt-2 text-text-muted">Loading games…</p>}
      {games.error && <p className="mt-2 text-accent">{games.error}</p>}
      {!games.loading && !games.error && games.rows.length === 0 && (
        <p className="mt-2 text-text-muted">No games suggested yet.</p>
      )}

      <ul className="mt-2 flex flex-col gap-1">
        {games.rows.map(({ proposalGameId, game, voteCount, votedByMe }) => (
          <li key={proposalGameId} className="flex items-center gap-2">
            {proposalStatus === 'collecting' ? (
              <button
                type="button"
                aria-label={votedByMe ? 'Remove your vote' : 'Vote for this game'}
                className={`text-lg leading-none ${votedByMe ? 'text-accent' : 'text-text-muted'}`}
                disabled={busy}
                onClick={() => void (votedByMe ? games.unvote(proposalGameId) : games.vote(proposalGameId))}
              >
                ▲
              </button>
            ) : null}
            <span>{game.name}</span>
            <Badge>
              {voteCount} vote{voteCount === 1 ? '' : 's'}
            </Badge>
          </li>
        ))}
      </ul>

      {games.actionError && <p className="mt-2 text-accent">{games.actionError}</p>}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Pick a game</DialogTitle>
          <DialogClose className="mb-2 mt-1 block text-sm text-text-muted">Close ✕</DialogClose>

          <input
            type="search"
            placeholder="Filter by name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-2 w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm"
          />

          {library.loading && <p className="text-sm text-text-muted">Loading library…</p>}
          {library.error && <p className="text-sm text-accent">{library.error}</p>}
          {!library.loading && !library.error && filtered.length === 0 && (
            <p className="text-sm text-text-muted">Nothing matches — the library comes from members&apos; imported BGG collections.</p>
          )}

          <ul className="flex flex-col gap-1">
            {filtered.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="block w-full rounded-sm bg-surface px-2 py-1 text-left text-sm hover:bg-surface-raised"
                  disabled={busy}
                  onClick={() => {
                    void games.proposeGame(g.id);
                    setPickerOpen(false);
                    setFilter('');
                  }}
                >
                  {g.name}
                  <span className="ml-2 text-xs text-text-muted">
                    {g.minPlayers}–{g.maxPlayers} players
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogSheetContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Swap the static games list out of the panel**

In `apps/web/components/proposal-detail-panel.tsx`:

Remove the old `Suggested games` `<div>` block (the one mapping `detail.games`). Add import:

```tsx
import { ProposalGamesSection } from '@/components/proposal-games-section';
```

Mount inside the non-cancelled branch, after the RSVPs list:

```tsx
<ProposalGamesSection
  proposalId={detail.proposal.id}
  groupId={detail.proposal.groupId}
  proposalStatus={detail.proposal.status}
  onChanged={onChanged}
/>
```

Note: `detail.games` remains part of the fetched payload but the panel no longer renders it — the section owns that data now.

- [ ] **Step 5: Verify**

Run: `npm run lint -w @bggg/web && npm run build -w @bggg/web`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/hooks/use-proposal-games.ts apps/web/hooks/use-group-library.ts apps/web/components/proposal-games-section.tsx apps/web/components/proposal-detail-panel.tsx
git commit -m "feat: game voting and group-library picker in proposal panel"
```

---

### Task 12: Create-proposal dialog + calendar pages wiring

**Files:**
- Create: `apps/web/hooks/use-groups.ts`
- Create: `apps/web/components/create-proposal-dialog.tsx`
- Modify: `apps/web/components/group-calendar-view.tsx`
- Modify: `apps/web/app/(shell)/calendar/page.tsx`
- Modify: `apps/web/components/proposal-detail-panel.tsx` (pass parent refresh through — done via prop already; only verification here)

**Interfaces:**
- Consumes: `POST /groups/:groupId/proposals` body `{ proposedDate: 'YYYY-MM-DD' }` (CreateProposalDto `@IsDateString()`); `toDateKey` from lib/calendar-grid; `apiMutate`; `Proposal`, `Group` types.
- Produces:
  - `useGroups()` → `{ groups: Group[]; loading: boolean; error: string | null; retry(): void }`.
  - `CreateProposalDialog` props: `{ open: boolean; onOpenChange: (open: boolean) => void; groups: Group[]; defaultGroupId?: string; onCreated: (proposal: Proposal) => void }`.

- [ ] **Step 1: use-groups hook**

Create `apps/web/hooks/use-groups.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { Group } from '@/lib/types';

interface UseGroupsResult {
  groups: Group[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useGroups(): UseGroupsResult {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manual fetch-in-effect (see use-proposals.ts).
    setLoading(true);
    setError(null);

    apiFetch('/groups')
      .then((res) => {
        if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
        return res.json();
      })
      .then((data: Group[]) => {
        if (!cancelled) setGroups(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your groups');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { groups, loading, error, retry: () => setRefreshKey((k) => k + 1) };
}
```

- [ ] **Step 2: Create-proposal dialog component**

Create `apps/web/components/create-proposal-dialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toDateKey } from '@/lib/calendar-grid';
import { apiMutate } from '@/lib/api';
import type { Group, Proposal } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

interface CreateProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: Group[];
  /** Preselected group (the page the button lives on); omit on aggregate pages. */
  defaultGroupId?: string;
  onCreated: (proposal: Proposal) => void;
}

// Propose a game night: pick a day (Decision G anchors everything else —
// windows, defaults — to this date) and optionally which group. The server
// creates the creator's implicit yes-RSVP, so nothing else is asked here.
export function CreateProposalDialog({ open, onOpenChange, groups, defaultGroupId, onCreated }: CreateProposalDialogProps) {
  const [groupId, setGroupId] = useState(defaultGroupId ?? '');
  const [date, setDate] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveGroupId = groupId || groups[0]?.id || '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveGroupId || !date) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiMutate(`/groups/${effectiveGroupId}/proposals`, 'POST', {
        proposedDate: date,
      });
      const created = (await response.json()) as Proposal;
      setDate('');
      onOpenChange(false);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the proposal');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setError(null);
        onOpenChange(o);
      }}
    >
      <DialogSheetContent aria-describedby={undefined}>
        <DialogTitle>New proposal</DialogTitle>
        <DialogClose className="mb-3 mt-1 block text-sm text-text-muted">Close ✕</DialogClose>

        <form onSubmit={submit} className="flex flex-col gap-3 font-body text-sm">
          <label className="flex flex-col gap-1">
            Group
            <select
              value={effectiveGroupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={pending || groups.length === 0}
              className="rounded-sm border border-border bg-surface px-2 py-1"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.isSolo ? `${g.name} (solo)` : g.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            Date
            <input
              type="date"
              required
              min={toDateKey(new Date())}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              className="rounded-sm border border-border bg-surface px-2 py-1"
            />
          </label>

          {error && <p className="text-accent">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !effectiveGroupId || !date}>
              {pending ? 'Creating…' : 'Create proposal'}
            </Button>
            <DialogClose className="self-center text-sm text-text-muted underline">Cancel</DialogClose>
          </div>
        </form>
      </DialogSheetContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire into GroupCalendarView**

Replace the body of `apps/web/components/group-calendar-view.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { useGroupProposals } from '@/hooks/use-proposals';
import { useGroups } from '@/hooks/use-groups';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { ProposalDetailPanel } from '@/components/proposal-detail-panel';
import { CreateProposalDialog } from '@/components/create-proposal-dialog';
import { Button } from '@/components/ui/button';

export function GroupCalendarView({ groupId }: { groupId: string }) {
  const { proposals, loading, error, retry } = useGroupProposals(groupId);
  const { groups } = useGroups();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Any successful panel action can move badges between days (finalize
  // re-dates placement, undo/cancel removes them) — bump the list too.
  const refreshAll = () => {
    retry();
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg">Schedule</h2>
        <Button type="button" className="px-3 py-1 text-xs" onClick={() => setCreateOpen(true)}>
          + New proposal
        </Button>
      </div>

      {loading && <p>Loading this group&apos;s schedule…</p>}
      {error && (
        <p className="text-accent">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}
      <CalendarMonthGrid proposals={proposals} onSelectProposal={(proposal) => setSelectedId(proposal.id)} />
      <ProposalDetailPanel proposalId={selectedId} onClose={() => setSelectedId(null)} onChanged={refreshAll} />

      <CreateProposalDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        groups={groups.length > 0 ? groups : [{ id: groupId, name: 'This group', ownerId: '', isSolo: false, createdAt: '' }]}
        defaultGroupId={groupId}
        onCreated={(created) => {
          setSelectedId(created.id);
          refreshAll();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Wire into the personal calendar page**

Replace the body of `apps/web/app/(shell)/calendar/page.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { useAggregateProposals } from '@/hooks/use-proposals';
import { useGroups } from '@/hooks/use-groups';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { ProposalDetailPanel } from '@/components/proposal-detail-panel';
import { CreateProposalDialog } from '@/components/create-proposal-dialog';
import { Button } from '@/components/ui/button';

export default function PersonalCalendarPage() {
  const { proposals, loading, error, retry } = useAggregateProposals();
  const { groups } = useGroups();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg">My schedule</h2>
        <Button type="button" className="px-3 py-1 text-xs" onClick={() => setCreateOpen(true)}>
          + New proposal
        </Button>
      </div>

      {loading && <p>Loading your schedule…</p>}
      {error && (
        <p className="text-accent">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}
      <CalendarMonthGrid proposals={proposals} onSelectProposal={(proposal) => setSelectedId(proposal.id)} />
      <ProposalDetailPanel proposalId={selectedId} onClose={() => setSelectedId(null)} onChanged={retry} />

      <CreateProposalDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        groups={groups}
        onCreated={(created) => {
          setSelectedId(created.id);
          retry();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run lint -w @bggg/web && npm run build -w @bggg/web`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/hooks/use-groups.ts apps/web/components/create-proposal-dialog.tsx apps/web/components/group-calendar-view.tsx "apps/web/app/(shell)/calendar/page.tsx"
git commit -m "feat: proposal creation dialog on calendar pages"
```

---

### Task 13: Calendar feed settings on profile

**Files:**
- Create: `apps/web/hooks/use-calendar-feed-token.ts`
- Create: `apps/web/components/calendar-feed-settings.tsx`
- Modify: `apps/web/app/(shell)/profile/page.tsx`

**Interfaces:**
- Consumes: `POST /calendar/token` → `{ feedUrl: string }` (issuing replaces the old token — that IS regeneration).
- Produces: `useCalendarFeedToken()` → `{ feedUrl: string | null; pending: boolean; error: string | null; generate(): Promise<void> }`; `CalendarFeedSettings` component (no props).

- [ ] **Step 1: Hook**

Create `apps/web/hooks/use-calendar-feed-token.ts`:

```ts
'use client';

import { useState } from 'react';
import { apiMutate } from '@/lib/api';

interface CalendarFeedTokenState {
  feedUrl: string | null;
  pending: boolean;
  error: string | null;
  generate: () => Promise<void>;
}

// The raw feed URL exists only in this component's memory (and wherever
// the user pastes it) — POST /calendar/token stores only the hash, so
// there is deliberately no "fetch my existing URL" call. Generating again
// invalidates the previous URL; that replacement is the whole regeneration
// story.
export function useCalendarFeedToken(): CalendarFeedTokenState {
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const response = await apiMutate('/calendar/token', 'POST');
      const data = (await response.json()) as { feedUrl: string };
      setFeedUrl(data.feedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the feed URL');
    } finally {
      setPending(false);
    }
  }

  return { feedUrl, pending, error, generate };
}
```

- [ ] **Step 2: Settings component**

Create `apps/web/components/calendar-feed-settings.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useCalendarFeedToken } from '@/hooks/use-calendar-feed-token';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

// Subscribe-anywhere URL for the user's confirmed sessions across all
// their groups (Google/Apple Calendar "add by URL"). Regenerating kills
// the old link everywhere it's pasted — hence the confirm dialog.
export function CalendarFeedSettings() {
  const { feedUrl, pending, error, generate } = useCalendarFeedToken();
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!feedUrl) return;
    await navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="font-body text-sm">
      {!feedUrl ? (
        <>
          <p className="text-text-muted">
            Generate a private subscription URL for your calendar app. Anyone holding it sees your confirmed sessions — treat it like a password.
          </p>
          <Button type="button" className="mt-2" disabled={pending} onClick={() => void generate()}>
            {pending ? 'Generating…' : 'Generate feed URL'}
          </Button>
        </>
      ) : (
        <>
          <code className="block break-all rounded-sm bg-surface p-2 text-xs">{feedUrl}</code>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void copy()}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmRegenerate(true)}>
              Regenerate
            </Button>
          </div>
        </>
      )}

      {error && <p className="mt-2 text-accent">{error}</p>}

      <Dialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Generate a new feed URL?</DialogTitle>
          <p className="mt-2 text-sm text-text-muted">
            The current URL stops working everywhere it&apos;s subscribed. You&apos;d re-add the new one in your calendar app.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirmRegenerate(false);
                void generate();
              }}
            >
              Regenerate
            </Button>
            <DialogClose className="self-center text-sm text-text-muted underline">Keep current</DialogClose>
          </div>
        </DialogSheetContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Mount on profile**

In `apps/web/app/(shell)/profile/page.tsx`, add import:

```tsx
import { CalendarFeedSettings } from '@/components/calendar-feed-settings';
```

Insert a new section ABOVE `<ComingSoon label="Profile" />`:

```tsx
<section>
  <h2 className="font-display text-xl">Calendar feed</h2>
  <div className="mt-4">
    <CalendarFeedSettings />
  </div>
</section>
```

- [ ] **Step 4: Verify**

Run: `npm run lint -w @bggg/web && npm run build -w @bggg/web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/hooks/use-calendar-feed-token.ts apps/web/components/calendar-feed-settings.tsx "apps/web/app/(shell)/profile/page.tsx"
git commit -m "feat: calendar feed settings on profile"
```

---

### Task 14: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full API suite + build**

Run: `npm test -w @bggg/api && npm run build -w @bggg/api`
Expected: all suites pass, build succeeds.

- [ ] **Step 2: Full web lint + build**

Run: `npm run lint -w @bggg/web && npm run build -w @bggg/web`
Expected: zero errors/warnings.

- [ ] **Step 3: Manual walkthrough checklist (requires dev stack: `make dev-setup` per README, then sign in)**

Verify each flow in the browser against the running stack:

1. Group calendar → "+ New proposal" → pick tomorrow → Create → panel opens showing `collecting`, creator auto-RSVPed yes.
2. Panel: click Maybe → highlight moves. Open "Specify hours", fill 18:00–23:00 → Save hours.
3. Second browser profile (or another user): RSVP yes with different hours.
4. As creator: designate the other yes-RSVP as host → host badge appears; clear host works.
5. Add a game from the group library picker; vote ▲ (count 1, highlighted); un-vote (count 0).
6. Request confirmation → status `confirming`, stored window shown; both yes/maybe holders lock in → "Locked in" badges.
7. Finalize → status `confirmed`; badge on the grid moves to the confirmed date.
8. Undo confirmation (confirm dialog) → back to `collecting`, lock-ins reset.
9. Cancel the proposal → banner shows; badge disappears from grid.
10. Recreate a proposal, confirm + finalize; then Cancel session → session gone, banner shows.
11. Profile → Calendar feed → Generate → copy URL; `curl "<url>"` returns `text/calendar` VCALENDAR body; Regenerate → old URL now 401/403.
12. Personal calendar page: aggregate view loads; create proposal via group selector works.

- [ ] **Step 4: Fix anything found, re-run relevant steps, then commit any fixes**

```bash
git add -A && git commit -m "fix: scheduling walkthrough findings"
```

(skip if nothing was found)

---

## Self-Review Notes

- **Spec coverage:** cancel endpoint (T1), CORS PUT (T2), group library (T5), full mutation UI (T8–T12), iCal management (T13), Monday-first + initials grid (T7). Spec's "Data flow example" covered by T9's hours path. `votedByMe`/role additions (T3/T4) support the panel gating the spec's tables require.
- **Type consistency:** `ProposalGameWithVotes` (API) ↔ `ProposalGameSummary` (web) field names match (`proposalGameId`, `game`, `voteCount`, `votedByMe`). `RsvpInput` matches `RsvpDto` keys. `DesignateHostDto.userId` ↔ `setHost` body. Members `role` values `'owner'|'admin'|'member'` match `GroupMemberInfo`.
- **Known deliberate deviations from the letter of earlier drafts:** games section self-fetches `/proposals/:id/games` (spec's `useProposalGames` contract) rather than reading `detail.games` — noted inline in Task 11.
