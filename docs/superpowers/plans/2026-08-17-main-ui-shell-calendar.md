# Main UI Shell + Calendar View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app's first real UI — a persistent shell (identity, navigation, group switching) plus a fully-functional, read-only monthly calendar view, with collection/profile as navigable stubs.

**Architecture:** Three backend additions to the existing NestJS API (solo-group auto-provisioning, a group-members-with-names endpoint, folding proposal games into the proposal-detail response), followed by a Next.js App Router frontend built bottom-up: auth token refresh → a shared `apiFetch` helper → data hooks → presentational components → routed pages that wire them together.

**Tech Stack:** NestJS 11 + TypeORM (backend, `apps/api`), Next.js 16 (App Router) + next-auth v5 (beta) + Tailwind v4 (frontend, `apps/web`), Jest for backend tests (no frontend test runner exists — frontend tasks are verified manually).

**Spec:** `docs/superpowers/specs/2026-08-17-main-ui-shell-design.md`

## Global Constraints

- The calendar is **read-only this round** — no RSVP/vote/host/confirm/create-proposal UI anywhere. (Spec Non-goals.)
- Cancelled proposals are never shown on the calendar grid. (Spec: "What's shown".)
- A proposal is placed on `confirmedStart`'s date if set, else `proposedDate`. (Spec: "Placement rule".)
- All frontend API calls go through one shared helper (`apps/web/lib/api.ts`) — never a raw `fetch('/api/...')` scattered in a component. (Spec: "Frontend API access".)
- Collection and profile views are static "coming soon" placeholders in both spaces — no data fetching, no backend changes for them. (Spec Non-goals.)
- No new frontend test infrastructure. Frontend tasks are verified manually via the dev server (`npm run dev --workspace=apps/web`); backend tasks get Jest unit tests following `apps/api`'s existing patterns (mocked `Repository`/`HttpService` via `@nestjs/testing`, no real database).
- `apps/web/AGENTS.md` warns this Next.js version has breaking changes from stable Next.js. The two places this plan touches version-sensitive App Router APIs (dynamic-route `params` as a `Promise`, and the named-function `'use server'` form-action pattern) have already been verified against `node_modules/next/dist/docs/` and are written correctly below — no need to re-check those two. If a task needs any other App Router API not already verified here, check `node_modules/next/dist/docs/` before writing code rather than assuming a prior Next.js version's behavior.

---

## Task 1: Backend — lazy solo-group provisioning

**Files:**
- Modify: `apps/api/src/groups/group.entity.ts`
- Modify: `apps/api/src/groups/groups.service.ts`
- Modify: `apps/api/src/groups/groups.service.spec.ts`
- Modify: `apps/api/src/groups/groups.controller.spec.ts`
- Modify: `db/schema.sql`

**Interfaces:**
- Produces: `Group.isSolo: boolean` (entity field, maps to `groups.is_solo` column). `GroupsService.findAll(requestingUserId: string): Promise<Group[]>` now never returns `[]` — a user with zero memberships gets a freshly-provisioned solo group instead.

- [ ] **Step 1: Add the `is_solo` column to the `Group` entity**

Edit `apps/api/src/groups/group.entity.ts`, adding after the `ownerId` column:

```typescript
  // True for the one auto-provisioned group every user always belongs to
  // (their own solo space) — see GroupsService.findAll. Lets the frontend
  // label it distinctly ("Just Me") without a naming convention on `name`.
  @Column({ name: 'is_solo', default: false })
  isSolo!: boolean;
```

- [ ] **Step 2: Update the reference schema**

Edit `db/schema.sql`'s `groups` table definition (in the `-- ── GROUPS ──` section) to add the column:

```sql
CREATE TABLE IF NOT EXISTS groups (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT         NOT NULL,
  owner_id    TEXT         NOT NULL,
  is_solo     BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

Add a comment above the table (in the existing comment block) noting: `is_solo: true for the one group every user is auto-provisioned on first GroupsService.findAll() call with zero memberships (see groups.service.ts) — lets the group switcher label it distinctly.`

If you have a dev database already running with an existing `groups` table, `CREATE TABLE IF NOT EXISTS` won't retroactively add the column — apply it by hand once:

```bash
docker compose -f docker-compose.dev.yml exec db psql -U bggg -d bggg_dev \
  -c "ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_solo BOOLEAN NOT NULL DEFAULT false;"
```

- [ ] **Step 3: Fix every pre-existing `Group` fixture**

`Group` just gained a required `isSolo` field, so every existing `Group` object literal in the test suite is now a TypeScript compile error until it's added. Add `isSolo: false,` immediately after `ownerId: ...,` in every existing `Group` literal that doesn't already specify it:

- `apps/api/src/groups/groups.service.spec.ts` — the two literals in `findAll`'s first test (`group-1`, `group-2`), the literal in `findOne`'s first test, the two literals in `create`'s test (`built`, `saved`), the literal in `update`'s two tests, and the literal in `remove`'s two tests.
- `apps/api/src/groups/groups.controller.spec.ts` — the literals in `findAll`'s test, `findOne`'s first test, and `create`'s test (three total; `remove`'s test has no `Group` literal to fix).

None of these tests' assertions need to change — they just need `isSolo: false` added to compile.

- [ ] **Step 4: Write the failing test for solo-group provisioning**

Edit `apps/api/src/groups/groups.service.spec.ts`. Replace the existing second test in the `findAll` describe block (`'should return an empty array without querying groups when the user has no memberships'` — this behavior no longer exists) with:

```typescript
    it('should provision and return a solo group when the user has no memberships', async () => {
      mockMembersRepository.findBy.mockResolvedValue([]);
      const builtGroup: Group = {
        id: 'solo-1', name: 'Just Me', ownerId: OWNER_ID, isSolo: true, createdAt: new Date(),
      };
      const builtMembership: GroupMember = {
        id: 99, userId: OWNER_ID, groupId: 'solo-1', role: 'owner', joinedAt: new Date(),
      };
      mockRepository.create.mockReturnValue(builtGroup);
      mockRepository.save.mockResolvedValue(builtGroup);
      mockMembersRepository.create.mockReturnValue(builtMembership);
      mockMembersRepository.save.mockResolvedValue(builtMembership);

      const result = await service.findAll(OWNER_ID);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Just Me', ownerId: OWNER_ID, isSolo: true }),
      );
      expect(mockMembersRepository.save).toHaveBeenCalledWith(builtMembership);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: OWNER_ID, action: 'group.created' }),
      );
      // No second query against groups by id — the freshly-created group is
      // already the whole answer.
      expect(mockRepository.findBy).not.toHaveBeenCalled();
      expect(result).toEqual([builtGroup]);
    });
```

- [ ] **Step 5: Run tests to verify the new one fails**

Run: `npm test --workspace=apps/api -- groups.service.spec.ts`
Expected: FAIL — `findAll` still returns `[]` for zero memberships, so `mockRepository.create` is never called.

- [ ] **Step 6: Implement the provisioning logic**

Edit `apps/api/src/groups/groups.service.ts`, replacing the `findAll` method:

```typescript
  async findAll(requestingUserId: string): Promise<Group[]> {
    const memberships = await this.members.findBy({ userId: requestingUserId });
    if (memberships.length === 0) {
      return [await this.provisionSoloGroup(requestingUserId)];
    }

    return this.groupRepository.findBy({
      id: In(memberships.map((m) => m.groupId)),
    });
  }

  // Every user always belongs to at least one group. A fixed, unpersonalized
  // name ("Just Me") is used on purpose — nothing in this backend resolves a
  // user's own display name from their JWT, and the UI already labels this
  // group distinctly via isSolo, so there's nothing a personalized name would
  // add. This is a real groups row (not a special-cased in-memory object) so
  // it can anchor solo proposals/sessions later, since group_id is NOT NULL
  // on play_session_proposals.
  private async provisionSoloGroup(userId: string): Promise<Group> {
    const group = this.groupRepository.create({ name: 'Just Me', ownerId: userId, isSolo: true });
    const saved = await this.groupRepository.save(group);

    await this.members.save(
      this.members.create({ userId, groupId: saved.id, role: 'owner' }),
    );

    await this.auditService.log({
      actorId: userId,
      action: 'group.created',
      targetType: 'group',
      targetId: String(saved.id),
      metadata: { name: saved.name, isSolo: true },
    });

    return saved;
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test --workspace=apps/api -- groups.service.spec.ts groups.controller.spec.ts`
Expected: PASS (all tests in both files, including the untouched `findOne`/`create`/`update`/`remove` describe blocks).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/groups/group.entity.ts apps/api/src/groups/groups.service.ts apps/api/src/groups/groups.service.spec.ts apps/api/src/groups/groups.controller.spec.ts db/schema.sql
git commit -m "feat(api): auto-provision a solo group for users with no memberships"
```

---

## Task 2: Backend — group members endpoint with display names

**Files:**
- Modify: `apps/api/src/keycloak/keycloak-admin.client.ts`
- Create: `apps/api/src/keycloak/keycloak-admin.client.spec.ts`
- Modify: `apps/api/src/groups/groups.service.ts`
- Modify: `apps/api/src/groups/groups.service.spec.ts`
- Modify: `apps/api/src/groups/groups.controller.ts`
- Modify: `apps/api/src/groups/groups.controller.spec.ts`
- Modify: `apps/api/src/groups/groups.module.ts`

**Interfaces:**
- Consumes: `Repository<GroupMember>.findBy({ groupId })` (existing).
- Produces: `KeycloakAdminClient.getUser(userId: string): Promise<{ id: string; displayName: string }>`. `GroupsService.getMembers(groupId: string, requestingUserId: string): Promise<Array<{ id: string; displayName: string }>>`. Route `GET /groups/:groupId/members`.

- [ ] **Step 1: Write the failing test for `KeycloakAdminClient.getUser`**

Create `apps/api/src/keycloak/keycloak-admin.client.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { KeycloakAdminClient } from './keycloak-admin.client';

describe('KeycloakAdminClient', () => {
  let client: KeycloakAdminClient;

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakAdminClient,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    client = module.get<KeycloakAdminClient>(KeycloakAdminClient);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getUser', () => {
    it('should return the user id and firstName as displayName', async () => {
      // getUser first needs a service-account token (same private
      // getServiceToken() every other method here already goes through).
      mockHttpService.post.mockReturnValue(
        of({ data: { access_token: 'service-token', expires_in: 60 } }),
      );
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: { id: 'user-1', username: 'alice', firstName: 'Alice' } }),
      );

      const result = await client.getUser('user-1');

      expect(result).toEqual({ id: 'user-1', displayName: 'Alice' });
    });

    it('should fall back to username when firstName is unset', async () => {
      mockHttpService.post.mockReturnValue(
        of({ data: { access_token: 'service-token', expires_in: 60 } }),
      );
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: { id: 'user-2', username: 'bob' } }),
      );

      const result = await client.getUser('user-2');

      expect(result).toEqual({ id: 'user-2', displayName: 'bob' });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=apps/api -- keycloak-admin.client.spec.ts`
Expected: FAIL — `getUser` doesn't exist on `KeycloakAdminClient` yet (TypeScript compile error surfaced as a test failure).

- [ ] **Step 3: Implement `getUser`**

Edit `apps/api/src/keycloak/keycloak-admin.client.ts`. Add this interface near `CreateKeycloakUserInput`:

```typescript
export interface KeycloakUserInfo {
  id: string;
  displayName: string;
}
```

Add this method to the `KeycloakAdminClient` class (after `createUser`, before `deleteUser`):

```typescript
  // Resolves a Keycloak sub to a display name — nothing else in this
  // backend does this for anyone but the logged-in user themself (their
  // own JWT claims). Used to label proposers/hosts/RSVPs by name instead
  // of raw subs. firstName is what createUser sets as the display name on
  // signup, but a manually admin-created seed user (see the dev-setup docs
  // in docs/reference/authentication-keycloak.md) may not have it set —
  // username is always present, so it's the fallback.
  async getUser(userId: string): Promise<KeycloakUserInfo> {
    const token = await this.getServiceToken();

    const response = await firstValueFrom(
      this.http.get(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      }),
    );

    if (response.status !== 200) {
      throw new HttpException(`Keycloak user lookup failed (${response.status})`, 502);
    }

    return {
      id: response.data.id,
      displayName: response.data.firstName ?? response.data.username,
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=apps/api -- keycloak-admin.client.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `GroupsService.getMembers`**

Edit `apps/api/src/groups/groups.service.spec.ts`. Add `KeycloakAdminClient` to the mocked providers in `beforeEach`:

```typescript
    // Added alongside the mockAuditService provider, same reasoning.
    {
      provide: KeycloakAdminClient,
      useValue: mockKeycloakAdmin,
    },
```

and declare `mockKeycloakAdmin` alongside the other mocks at the top of the file:

```typescript
const mockKeycloakAdmin = {
  getUser: jest.fn(),
};
```

Add the import:

```typescript
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client';
```

Add a new describe block (after `remove`):

```typescript
  // ── getMembers ───────────────────────────────────────────────────────────

  describe('getMembers', () => {
    it('should return display names for every member, after checking access', async () => {
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

      // findOne's own 404/403 check runs first — reused rather than
      // reimplemented, same pattern as update()/remove().
      expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: 'group-1' });
      expect(result).toEqual([
        { id: 'user-a', displayName: 'Alice' },
        { id: 'user-b', displayName: 'Bob' },
      ]);
    });

    it('should throw ForbiddenException when the requester is not a member', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getMembers('group-1', 'someone-else')).rejects.toThrow(ForbiddenException);
      expect(mockKeycloakAdmin.getUser).not.toHaveBeenCalled();
    });
  });
```

The new `group: Group` literal above already includes `isSolo: false` — every other fixture in this file was already fixed in Task 1.

- [ ] **Step 6: Run tests to verify the new ones fail**

Run: `npm test --workspace=apps/api -- groups.service.spec.ts`
Expected: FAIL — `service.getMembers` doesn't exist yet.

- [ ] **Step 7: Implement `GroupsService.getMembers`**

Edit `apps/api/src/groups/groups.service.ts`. Add the import:

```typescript
import { KeycloakAdminClient, KeycloakUserInfo } from '../keycloak/keycloak-admin.client';
```

Add `KeycloakAdminClient` to the constructor:

```typescript
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly members: Repository<GroupMember>,
    private readonly auditService: AuditService,
    private readonly keycloakAdmin: KeycloakAdminClient,
  ) {}
```

Add the method (after `findOne`):

```typescript
  // Reuses findOne's existing 404-vs-403 access check — same "look but
  // don't touch" read access every role gets, no stricter check needed
  // since this is read-only.
  async getMembers(id: string, requestingUserId: string): Promise<KeycloakUserInfo[]> {
    await this.findOne(id, requestingUserId);

    const memberships = await this.members.findBy({ groupId: id });
    return Promise.all(memberships.map((m) => this.keycloakAdmin.getUser(m.userId)));
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test --workspace=apps/api -- groups.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Wire `KeycloakModule` into `GroupsModule`**

Edit `apps/api/src/groups/groups.module.ts`:

```typescript
import { KeycloakModule } from '../keycloak/keycloak.module';
```

Add `KeycloakModule` to `imports`:

```typescript
  imports: [TypeOrmModule.forFeature([Group, GroupMember]), AuditModule, KeycloakModule],
```

(No circular dependency: `KeycloakModule` never imports `GroupsModule` — same reasoning already documented in `invites.module.ts`.)

- [ ] **Step 10: Write the failing controller test**

Edit `apps/api/src/groups/groups.controller.spec.ts`. Add `getMembers: jest.fn()` to `mockGroupsService`, then add a new describe block:

```typescript
  describe('getMembers', () => {
    it('should call groupsService.getMembers with the group id and requesting user', async () => {
      const members = [{ id: 'user-a', displayName: 'Alice' }];
      mockGroupsService.getMembers.mockResolvedValue(members);

      const result = await controller.getMembers('group-1', fakeRequest);

      expect(mockGroupsService.getMembers).toHaveBeenCalledWith('group-1', 'user-1');
      expect(result).toEqual(members);
    });
  });
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `npm test --workspace=apps/api -- groups.controller.spec.ts`
Expected: FAIL — `controller.getMembers` doesn't exist.

- [ ] **Step 12: Add the route**

Edit `apps/api/src/groups/groups.controller.ts`. Add after `findOne`:

```typescript
  // GET /groups/:groupId/members → 200 OK with { id, displayName }[] for
  // every member. Same 404 (no such group) / 403 (not a member) split as
  // findOne, since getMembers reuses it.
  @Get(':groupId/members')
  getMembers(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupsService.getMembers(groupId, req.user.sub);
  }
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `npm test --workspace=apps/api -- groups.controller.spec.ts groups.service.spec.ts keycloak-admin.client.spec.ts`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/api/src/keycloak/keycloak-admin.client.ts apps/api/src/keycloak/keycloak-admin.client.spec.ts apps/api/src/groups/groups.service.ts apps/api/src/groups/groups.service.spec.ts apps/api/src/groups/groups.controller.ts apps/api/src/groups/groups.controller.spec.ts apps/api/src/groups/groups.module.ts
git commit -m "feat(api): add GET /groups/:groupId/members resolving display names"
```

---

## Task 3: Backend — fold proposal games into `getProposal`

**Files:**
- Modify: `apps/api/src/scheduling/scheduling.service.ts`
- Create: `apps/api/src/scheduling/scheduling.service.spec.ts`

**Interfaces:**
- Produces: `SchedulingService.getProposal(proposalId, requestingUserId): Promise<{ proposal: PlaySessionProposal; rsvps: PlaySessionRsvp[]; games: Array<{ game: PlaySessionProposalGame; voteCount: number }> }>` — previously returned only `{ proposal, rsvps }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/scheduling/scheduling.service.spec.ts`. This is the first spec file for `SchedulingService`, so it needs mocks for every constructor dependency even though this test only exercises `getProposal`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulingService } from './scheduling.service';
import { PlaySessionProposal } from './play-session-proposal.entity';
import { PlaySessionRsvp } from './play-session-rsvp.entity';
import { PlaySession } from './play-session.entity';
import { PlaySessionProposalGame } from './play-session-proposal-game.entity';
import { PlaySessionProposalGameVote } from './play-session-proposal-game-vote.entity';
import { GroupMember } from '../groups/group-member.entity';
import { GroupsService } from '../groups/groups.service';

const GROUP_ID = 'group-1';
const PROPOSAL_ID = 'proposal-1';
const USER_ID = 'user-1';

describe('SchedulingService', () => {
  let service: SchedulingService;

  const mockProposals = { findOneBy: jest.fn() };
  const mockRsvps = { findBy: jest.fn() };
  const mockSessions = {};
  const mockProposalGames = { findBy: jest.fn() };
  const mockGameVotes = { countBy: jest.fn() };
  const mockMembers = {};
  const mockGroupsService = { findOne: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulingService,
        { provide: getRepositoryToken(PlaySessionProposal), useValue: mockProposals },
        { provide: getRepositoryToken(PlaySessionRsvp), useValue: mockRsvps },
        { provide: getRepositoryToken(PlaySession), useValue: mockSessions },
        { provide: getRepositoryToken(PlaySessionProposalGame), useValue: mockProposalGames },
        { provide: getRepositoryToken(PlaySessionProposalGameVote), useValue: mockGameVotes },
        { provide: getRepositoryToken(GroupMember), useValue: mockMembers },
        { provide: GroupsService, useValue: mockGroupsService },
      ],
    }).compile();

    service = module.get<SchedulingService>(SchedulingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getProposal', () => {
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
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockRsvps.findBy.mockResolvedValue(rsvps);
      mockProposalGames.findBy.mockResolvedValue([proposalGame]);
      mockGameVotes.countBy.mockResolvedValue(2);

      const result = await service.getProposal(PROPOSAL_ID, USER_ID);

      expect(result).toEqual({
        proposal,
        rsvps,
        games: [{ game: proposalGame, voteCount: 2 }],
      });
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=apps/api -- scheduling.service.spec.ts`
Expected: FAIL — actual result is `{ proposal, rsvps }` with no `games` key.

- [ ] **Step 3: Implement the change**

Edit `apps/api/src/scheduling/scheduling.service.ts`. Replace the `getProposal` method:

```typescript
  async getProposal(
    proposalId: string,
    requestingUserId: string,
  ): Promise<{
    proposal: PlaySessionProposal;
    rsvps: PlaySessionRsvp[];
    games: Array<{ game: PlaySessionProposalGame; voteCount: number }>;
  }> {
    const proposal = await this.findProposalOrThrow(proposalId);
    await this.groupsService.findOne(proposal.groupId, requestingUserId);

    const rsvps = await this.rsvps.findBy({ proposalId });
    // Reuses listProposalGames' own vote-counting logic rather than
    // duplicating it — the redundant proposal/membership re-check inside it
    // is cheap at this project's scale and keeps this a one-line call
    // instead of extracting a shared private helper for one caller.
    const games = await this.listProposalGames(proposalId, requestingUserId);
    return { proposal, rsvps, games };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=apps/api -- scheduling.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test --workspace=apps/api`
Expected: PASS (no other test in the suite calls `getProposal`, so nothing else should be affected — this confirms it).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/scheduling/scheduling.service.ts apps/api/src/scheduling/scheduling.service.spec.ts
git commit -m "feat(api): include proposed games in GET /proposals/:id"
```

---

## Task 4: Frontend — Auth.js access-token refresh

**Files:**
- Modify: `apps/web/auth.ts`

**Interfaces:**
- Produces: `Session.accessToken: string`, `Session.error?: 'RefreshTokenError'` — consumed by `apps/web/lib/api.ts` in Task 5.

- [ ] **Step 1: Add the callbacks and type augmentation**

Edit `apps/web/auth.ts`:

```typescript
import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: '/web/auth',
  providers: [Keycloak],

  callbacks: {
    // Runs on every request that reads the session. `account` is only
    // present on the initial sign-in (the OAuth exchange) — every
    // subsequent call re-reads the persisted JWT and, once the access
    // token has expired, refreshes it via Keycloak's refresh-token grant.
    // Without this, a client-side /api/* call would start failing partway
    // through a session the moment the (short-lived) access token expired.
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          // account.expires_at is seconds since epoch (OAuth standard),
          // not milliseconds.
          expiresAt: account.expires_at,
        };
      }

      if (typeof token.expiresAt === 'number' && Date.now() < token.expiresAt * 1000) {
        return token;
      }

      try {
        const response = await fetch(
          `${process.env.AUTH_KEYCLOAK_ISSUER}/protocol/openid-connect/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: process.env.AUTH_KEYCLOAK_ID ?? '',
              client_secret: process.env.AUTH_KEYCLOAK_SECRET ?? '',
              refresh_token: token.refreshToken as string,
            }),
          },
        );
        const refreshed = await response.json();
        if (!response.ok) throw refreshed;

        return {
          ...token,
          accessToken: refreshed.access_token,
          // Keycloak may or may not rotate the refresh token itself —
          // fall back to the existing one if it didn't.
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
        };
      } catch {
        // Surfaced on the session as `error` — apps/web/lib/api.ts checks
        // this and forces a sign-out rather than calling the API with a
        // token it knows is dead.
        return { ...token, error: 'RefreshTokenError' as const };
      }
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.error = token.error as 'RefreshTokenError' | undefined;
      return session;
    },
  },
});

// Module augmentation: next-auth's default Session/JWT types don't know
// about these fields — without this, every read of session.accessToken or
// token.expiresAt above is a TypeScript error.
declare module 'next-auth' {
  interface Session {
    accessToken: string;
    error?: 'RefreshTokenError';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: 'RefreshTokenError';
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: build succeeds (this also validates the `declare module` augmentations compile).

- [ ] **Step 3: Manually verify the token appears on the session**

Start the dev stack (`docker compose up -d db keycloak` plus `npm run dev:api` and `npm run dev:web` per the existing dev setup in `docs/reference/authentication-keycloak.md`), log in through the browser as usual, then visit `http://localhost:3000/web/auth/session` directly. Confirm the returned JSON includes a non-empty `accessToken` field and no `error` field.

- [ ] **Step 4: Commit**

```bash
git add apps/web/auth.ts
git commit -m "feat(web): expose and refresh the Keycloak access token on the session"
```

---

## Task 5: Frontend — SessionProvider and the shared `apiFetch` helper

**Files:**
- Create: `apps/web/app/providers.tsx`
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/lib/api.ts`

**Interfaces:**
- Consumes: `Session.accessToken`, `Session.error` (Task 4).
- Produces: `apiFetch(path: string, init?: RequestInit): Promise<Response>` — every later frontend task that talks to the backend calls this, never raw `fetch('/api/...')`.

- [ ] **Step 1: Add the SessionProvider wrapper**

Create `apps/web/app/providers.tsx`:

```tsx
'use client';

import { SessionProvider } from 'next-auth/react';

// Auth.js's client helpers (getSession, signOut, useSession) read their
// base path from this provider's config at mount time — auth.ts sets
// basePath: '/web/auth' server-side, so this has to match, or client calls
// silently target the wrong (nonexistent, since '/api' is unconditionally
// the NestJS backend) route.
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath="/web/auth">{children}</SessionProvider>;
}
```

- [ ] **Step 2: Wrap the root layout**

Edit `apps/web/app/layout.tsx`, importing `Providers` and wrapping `{children}`:

```tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'BGGG — Board Game Group',
  description: 'Organise play sessions with your board game group',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#4f46e5',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Write `apiFetch`**

Create `apps/web/lib/api.ts`:

```typescript
'use client';

import { getSession, signOut } from 'next-auth/react';

// Every client-side call to apps/api goes through here — see
// docs/reference/authentication-keycloak.md's "Frontend calls to apps/api
// need the raw access token" section for why. Centralizing here is what
// keeps "expose the token to browser JS" a cheaply reversible decision: a
// future switch to a server-side proxy only changes this one file.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await getSession();

  if (!session || session.error === 'RefreshTokenError') {
    await signOut({ redirectTo: '/web/login' });
    throw new Error('Session expired');
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (response.status === 401) {
    // The proactive check above should catch a dead session before this
    // point — this is the backstop for the case it doesn't (e.g. Keycloak
    // revoked the session server-side).
    await signOut({ redirectTo: '/web/login' });
    throw new Error('Session expired');
  }

  return response;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: build succeeds. (Functional verification of `apiFetch` happens in Task 6, once there's a UI surface calling it.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/providers.tsx apps/web/app/layout.tsx apps/web/lib/api.ts
git commit -m "feat(web): add SessionProvider and a shared authenticated fetch helper"
```

---

## Task 6: Frontend — group switcher

**Files:**
- Create: `apps/web/lib/types.ts`
- Create: `apps/web/lib/space.ts`
- Create: `apps/web/components/group-switcher.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 5), `GET /groups` (returns `Group[]`), `POST /groups` (body `{ name: string }`, returns `Group`).
- Produces: `Group` type, `parseSpacePath(pathname): { groupId: string | null; tab: ViewTab }`, `spaceHref(groupId, tab): string`, `<GroupSwitcher />` — all reused by Task 7's `ViewTabs`/layout.

- [ ] **Step 1: Add the shared `Group` type**

Create `apps/web/lib/types.ts`:

```typescript
// Mirrors apps/api/src/groups/group.entity.ts's JSON shape (camelCase
// property names, since Nest serializes entity instances as-is).
export interface Group {
  id: string;
  name: string;
  ownerId: string;
  isSolo: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: Add the space-path helpers**

Create `apps/web/lib/space.ts`:

```typescript
export type ViewTab = 'calendar' | 'collection' | 'profile';

const TABS: ViewTab[] = ['calendar', 'collection', 'profile'];

export interface SpacePath {
  groupId: string | null;
  tab: ViewTab;
}

// The shell has two parallel "spaces" (user-level and group-level) that
// share the same three tabs — see the design spec's "Two spaces, one set
// of views". Both the group switcher and the view tabs need to parse the
// current URL into (space, tab) so switching one preserves the other.
export function parseSpacePath(pathname: string): SpacePath {
  const groupMatch = pathname.match(/^\/groups\/([^/]+)\/([^/]+)/);
  if (groupMatch) {
    const [, groupId, maybeTab] = groupMatch;
    const tab = (TABS as string[]).includes(maybeTab) ? (maybeTab as ViewTab) : 'calendar';
    return { groupId, tab };
  }

  const userMatch = pathname.match(/^\/([^/]+)/);
  const tab =
    userMatch && (TABS as string[]).includes(userMatch[1]) ? (userMatch[1] as ViewTab) : 'calendar';
  return { groupId: null, tab };
}

export function spaceHref(groupId: string | null, tab: ViewTab): string {
  return groupId ? `/groups/${groupId}/${tab}` : `/${tab}`;
}
```

- [ ] **Step 3: Build the group switcher**

Create `apps/web/components/group-switcher.tsx`:

```tsx
'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { parseSpacePath, spaceHref } from '@/lib/space';
import type { Group } from '@/lib/types';

export function GroupSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const { groupId: activeGroupId, tab } = parseSpacePath(pathname);

  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/groups')
      .then((res) => res.json())
      .then((data: Group[]) => {
        if (!cancelled) setGroups(data);
      })
      .catch(() => {
        // Keep whatever list was already loaded (possibly empty on first
        // load) rather than clearing it — see the design spec's error
        // handling: group-switcher failures shouldn't block navigation.
        if (!cancelled) setError('Could not load groups');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateGroup(event: FormEvent) {
    event.preventDefault();
    if (!newGroupName.trim()) return;

    const response = await apiFetch('/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGroupName }),
    });
    const created: Group = await response.json();
    setGroups((prev) => [...prev, created]);
    setNewGroupName('');
    router.push(spaceHref(created.id, tab));
  }

  return (
    <div>
      <select
        aria-label="Select group"
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        value={activeGroupId ?? ''}
        onChange={(event) => router.push(spaceHref(event.target.value || null, tab))}
      >
        <option value="">Personal (all groups)</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.isSolo ? 'Just Me' : group.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={handleCreateGroup} className="mt-1 flex gap-1">
        <input
          type="text"
          value={newGroupName}
          onChange={(event) => setNewGroupName(event.target.value)}
          placeholder="New group name"
          className="w-32 rounded border border-gray-300 px-1 text-xs"
        />
        <button type="submit" className="text-xs text-blue-600">
          + Add
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Manually verify in the browser**

Temporarily edit `apps/web/app/page.tsx` to render `<GroupSwitcher />` below the existing placeholder text (add the import too), so there's somewhere to see it before the real shell exists in Task 7. Run `npm run dev --workspace=apps/web`, log in, and confirm:
- The dropdown shows "Personal (all groups)" plus at least "Just Me" (your auto-provisioned solo group from Task 1).
- Typing a name and clicking "+ Add" creates a real group (verify via `curl` or the Plane-independent `GET /api/groups` in a second tab) and the dropdown updates.

Once confirmed, **revert** the temporary edit to `app/page.tsx` — Task 7 replaces this page's content for real. Commit only the new files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/types.ts apps/web/lib/space.ts apps/web/components/group-switcher.tsx
git commit -m "feat(web): add group switcher with solo-group labeling and inline create"
```

---

## Task 7: Frontend — shell layout, navigation, and stub pages

**Files:**
- Create: `apps/web/components/coming-soon.tsx`
- Create: `apps/web/components/view-tabs.tsx`
- Create: `apps/web/app/(shell)/layout.tsx`
- Create: `apps/web/app/(shell)/calendar/page.tsx`
- Create: `apps/web/app/(shell)/collection/page.tsx`
- Create: `apps/web/app/(shell)/profile/page.tsx`
- Create: `apps/web/app/(shell)/groups/[groupId]/calendar/page.tsx`
- Create: `apps/web/app/(shell)/groups/[groupId]/collection/page.tsx`
- Create: `apps/web/app/(shell)/groups/[groupId]/profile/page.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: `<GroupSwitcher />`, `parseSpacePath`/`spaceHref` (Task 6), `auth()`/`signOut()` (Task 4).
- Produces: a fully navigable shell — Task 11 replaces the two calendar pages' stub content with the real grid/panel wiring; the other four pages and the layout are final as of this task.

- [ ] **Step 1: Add the shared "coming soon" stub component**

Create `apps/web/components/coming-soon.tsx`:

```tsx
export function ComingSoon({ label }: { label: string }) {
  return <p className="text-gray-600">{label} view coming soon.</p>;
}
```

- [ ] **Step 2: Add the view tabs**

Create `apps/web/components/view-tabs.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { parseSpacePath, spaceHref, type ViewTab } from '@/lib/space';

const TABS: Array<{ tab: ViewTab; label: string }> = [
  { tab: 'calendar', label: 'Calendar' },
  { tab: 'collection', label: 'Collection' },
  { tab: 'profile', label: 'Profile' },
];

export function ViewTabs() {
  const pathname = usePathname();
  const { groupId, tab: activeTab } = parseSpacePath(pathname);

  return (
    <nav className="flex gap-3 text-sm font-medium">
      {TABS.map(({ tab, label }) => (
        <Link
          key={tab}
          href={spaceHref(groupId, tab)}
          className={tab === activeTab ? 'text-blue-600 underline' : 'text-gray-600'}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Build the shared shell layout**

Create `apps/web/app/(shell)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { GroupSwitcher } from '@/components/group-switcher';
import { ViewTabs } from '@/components/view-tabs';

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Belt-and-braces: proxy.ts's middleware already redirects unauthenticated
  // requests before they reach here, but a layout shouldn't assume that and
  // render a broken header if it's ever reached without a session.
  if (!session?.user) redirect('/web/login');

  // A Server Function declared inside the Server Component, per the
  // documented pattern in node_modules/next/dist/docs/01-app/02-guides/forms.md
  // ("How it works") — `<form action={...}>` takes a function that runs on
  // the server, which is how signOut() gets to run/set cookies at all (see
  // docs/reference/authentication-keycloak.md's note on signIn() having the
  // same constraint).
  async function logOut() {
    'use server';
    await signOut({ redirectTo: '/web/login' });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-4">
          <GroupSwitcher />
          <ViewTabs />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-700">{session.user.name}</span>
          <button type="button" disabled title="Coming soon" className="text-gray-400">
            Settings
          </button>
          <form action={logOut}>
            <button type="submit" className="text-gray-700 underline">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
```

This matches the documented pattern in `node_modules/next/dist/docs/01-app/02-guides/forms.md` exactly (a named async function declared in the component body, `'use server'` as its first statement, passed by reference to `action`) — confirmed against this installed Next.js version, no further verification needed.

- [ ] **Step 4: Add the stub pages**

Create `apps/web/app/(shell)/calendar/page.tsx`:

```tsx
import { ComingSoon } from '@/components/coming-soon';

export default function PersonalCalendarPage() {
  return <ComingSoon label="Calendar" />;
}
```

Create `apps/web/app/(shell)/collection/page.tsx`:

```tsx
import { ComingSoon } from '@/components/coming-soon';

export default function PersonalCollectionPage() {
  return <ComingSoon label="Collection" />;
}
```

Create `apps/web/app/(shell)/profile/page.tsx`:

```tsx
import { ComingSoon } from '@/components/coming-soon';

export default function PersonalProfilePage() {
  return <ComingSoon label="Profile" />;
}
```

Create `apps/web/app/(shell)/groups/[groupId]/calendar/page.tsx`:

```tsx
import { ComingSoon } from '@/components/coming-soon';

export default function GroupCalendarPage() {
  return <ComingSoon label="Calendar" />;
}
```

Create `apps/web/app/(shell)/groups/[groupId]/collection/page.tsx`:

```tsx
import { ComingSoon } from '@/components/coming-soon';

export default function GroupCollectionPage() {
  return <ComingSoon label="Collection" />;
}
```

Create `apps/web/app/(shell)/groups/[groupId]/profile/page.tsx`:

```tsx
import { ComingSoon } from '@/components/coming-soon';

export default function GroupProfilePage() {
  return <ComingSoon label="Profile" />;
}
```

- [ ] **Step 5: Redirect the root page**

Replace the contents of `apps/web/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

// The shell's default landing state is the user-level (personal, no group
// selected) calendar — see the design spec's "Two spaces" section. By the
// time this runs, proxy.ts's middleware has already confirmed a session
// exists.
export default function HomePage() {
  redirect('/calendar');
}
```

- [ ] **Step 6: Manually verify the full shell**

Run `npm run dev --workspace=apps/web`, log in, and confirm:
- Visiting `/` redirects to `/calendar`, which shows "Calendar view coming soon."
- The header shows your name, a disabled "Settings" button, a working "Log out" button, and the group switcher/tabs from Task 6.
- Clicking "Collection" / "Profile" tabs shows their stub text; the URL stays on `/collection` / `/profile` (no `groupId`).
- Selecting a real group (not "Personal") in the switcher navigates to `/groups/<id>/calendar`; clicking the tabs from there stays under `/groups/<id>/...` and shows the same stub text.
- Selecting "Personal (all groups)" again returns to `/calendar` (not a group route).
- "Log out" redirects to the login page.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/coming-soon.tsx apps/web/components/view-tabs.tsx "apps/web/app/(shell)" apps/web/app/page.tsx
git commit -m "feat(web): add shell layout, navigation, and stub views"
```

---

## Task 8: Frontend — proposal data hooks

**Files:**
- Modify: `apps/web/lib/types.ts`
- Create: `apps/web/lib/calendar-grid.ts`
- Create: `apps/web/hooks/use-proposals.ts`

**Interfaces:**
- Consumes: `apiFetch` (Task 5), `Group` type (Task 6), `GET /groups/:groupId/proposals`, `GET /groups`.
- Produces: `Proposal`, `ProposalWithGroup` types; `placementDateKey(proposal): string`; `useGroupProposals(groupId): { proposals: Proposal[]; loading: boolean; error: string | null; retry(): void }`; `useAggregateProposals(): { proposals: ProposalWithGroup[]; loading; error; retry }` — consumed by Task 9's grid and Task 11's pages.

- [ ] **Step 1: Add the proposal types**

Edit `apps/web/lib/types.ts`, adding:

```typescript
// Mirrors apps/api/src/scheduling/play-session-proposal.entity.ts's JSON
// shape. confirmedStart/End arrive as ISO datetime strings (Date -> JSON);
// proposedDate arrives as a bare "YYYY-MM-DD" (SQL DATE column typed as
// `string` on the entity, so it's never wrapped in a Date server-side).
export type ProposalStatus = 'collecting' | 'confirming' | 'confirmed' | 'cancelled';

export interface Proposal {
  id: string;
  groupId: string;
  createdBy: string;
  proposedDate: string;
  hostId: string | null;
  status: ProposalStatus;
  confirmedStart: string | null;
  confirmedEnd: string | null;
  createdAt: string;
}

// The user-level (aggregate) space merges proposals from every group the
// user belongs to onto one grid — this is what lets a badge say which
// group it came from.
export interface ProposalWithGroup extends Proposal {
  groupName: string;
}
```

- [ ] **Step 2: Add the date-grid and placement-rule helpers**

Create `apps/web/lib/calendar-grid.ts`:

```typescript
import type { Proposal } from './types';

export interface CalendarDay {
  date: Date;
  inMonth: boolean;
}

// Builds a full 7-column grid (Sun-Sat) for the month containing
// `monthAnchor`, including the leading/trailing days from adjacent months
// needed to fill complete weeks.
export function buildMonthGrid(monthAnchor: Date): CalendarDay[] {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: CalendarDay[] = [];
  for (let i = 0; i < startWeekday; i++) {
    days.push({ date: new Date(year, month, i - startWeekday + 1), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: new Date(year, month, d), inMonth: true });
  }
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1].date;
    days.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      inMonth: false,
    });
  }
  return days;
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

// The date a proposal is placed on — see the design spec's "Placement
// rule": confirmedStart's date once one exists, else proposedDate.
//
// proposedDate is a bare "YYYY-MM-DD" string with no time/zone component.
// `new Date('YYYY-MM-DD')` parses date-only ISO strings as UTC midnight —
// converting that back to local Y/M/D can roll it back a day in any
// negative-UTC-offset timezone. It's already in exactly the "YYYY-MM-DD"
// shape toDateKey produces, so it's used as-is instead of round-tripping
// through a Date object.
export function placementDateKey(proposal: Proposal): string {
  if (proposal.confirmedStart) {
    return toDateKey(new Date(proposal.confirmedStart));
  }
  return proposal.proposedDate;
}
```

- [ ] **Step 3: Add the data hooks**

Create `apps/web/hooks/use-proposals.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { Group, Proposal, ProposalWithGroup } from '@/lib/types';

// Cancelled proposals are never shown on the calendar (design spec's "What's
// shown" rule) — filtered here so both hooks below get it for free.
function isVisible(proposal: Proposal): boolean {
  return proposal.status !== 'cancelled';
}

async function fetchGroupProposals(groupId: string): Promise<Proposal[]> {
  const response = await apiFetch(`/groups/${groupId}/proposals`);
  const proposals: Proposal[] = await response.json();
  return proposals.filter(isVisible);
}

interface ProposalsResult<T> {
  proposals: T[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Group-level space: every non-cancelled proposal for one group.
export function useGroupProposals(groupId: string): ProposalsResult<Proposal> {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGroupProposals(groupId)
      .then((data) => {
        if (!cancelled) setProposals(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this month's schedule");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, refreshKey]);

  return { proposals, loading, error, retry: () => setRefreshKey((k) => k + 1) };
}

// User-level space: fan out across every group the user belongs to and
// merge, tagging each proposal with its source group's name.
export function useAggregateProposals(): ProposalsResult<ProposalWithGroup> {
  const [proposals, setProposals] = useState<ProposalWithGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch('/groups')
      .then((res) => res.json())
      .then(async (groups: Group[]) => {
        const perGroup = await Promise.all(
          groups.map(async (group) => {
            const groupProposals = await fetchGroupProposals(group.id);
            return groupProposals.map((proposal) => ({ ...proposal, groupName: group.name }));
          }),
        );
        if (!cancelled) setProposals(perGroup.flat());
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your schedule');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { proposals, loading, error, retry: () => setRefreshKey((k) => k + 1) };
}
```

- [ ] **Step 4: Manually verify with real data**

Create at least one real proposal for a real group via `curl` against `POST /api/groups/:groupId/proposals` (using a browser-copied access token, or via the browser's dev console calling `apiFetch`). Temporarily render `<pre>{JSON.stringify(useGroupProposals('<real-group-id>'), null, 2)}</pre>` inside `apps/web/app/(shell)/groups/[groupId]/calendar/page.tsx` (turning it into a client component temporarily) and confirm the real proposal appears with `loading: false` and no `error`. Do the same for `useAggregateProposals()` on `apps/web/app/(shell)/calendar/page.tsx`. **Revert both pages** to their Task 7 stub content afterward — Task 11 does the real wiring. Commit only the new/modified library files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/types.ts apps/web/lib/calendar-grid.ts apps/web/hooks/use-proposals.ts
git commit -m "feat(web): add group-level and aggregate proposal data hooks"
```

---

## Task 9: Frontend — calendar month grid

**Files:**
- Create: `apps/web/components/calendar-month-grid.tsx`

**Interfaces:**
- Consumes: `buildMonthGrid`, `toDateKey`, `placementDateKey` (Task 8), `Proposal`/`ProposalWithGroup` (Task 8).
- Produces: `<CalendarMonthGrid proposals={...} onSelectProposal={(proposal) => void} />` — consumed by Task 11's pages.

- [ ] **Step 1: Build the grid component**

Create `apps/web/components/calendar-month-grid.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { buildMonthGrid, placementDateKey, toDateKey } from '@/lib/calendar-grid';
import type { Proposal, ProposalWithGroup } from '@/lib/types';

const MAX_BADGES_PER_DAY = 3;

type CalendarItem = Proposal | ProposalWithGroup;

function hasGroupName(item: CalendarItem): item is ProposalWithGroup {
  return 'groupName' in item;
}

function badgeLabel(item: CalendarItem): string {
  const base = item.status === 'confirmed' ? 'Confirmed session' : 'Proposal';
  return hasGroupName(item) ? `${base} — ${item.groupName}` : base;
}

interface CalendarMonthGridProps {
  proposals: CalendarItem[];
  onSelectProposal: (proposal: CalendarItem) => void;
}

export function CalendarMonthGrid({ proposals, onSelectProposal }: CalendarMonthGridProps) {
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => new Date());

  const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const proposal of proposals) {
      const key = placementDateKey(proposal);
      const existing = map.get(key) ?? [];
      existing.push(proposal);
      map.set(key, existing);
    }
    return map;
  }, [proposals]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
        >
          ← Prev
        </button>
        <span className="font-semibold">
          {monthAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
        >
          Next →
        </button>
        <button type="button" onClick={() => setMonthAnchor(new Date())}>
          Today
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.map(({ date, inMonth }) => {
          const key = toDateKey(date);
          const dayItems = byDate.get(key) ?? [];
          const shown = dayItems.slice(0, MAX_BADGES_PER_DAY);
          const overflow = dayItems.length - shown.length;
          return (
            <div
              key={key}
              className={`min-h-20 rounded border p-1 text-xs ${
                inMonth ? 'bg-white' : 'bg-gray-100 text-gray-400'
              }`}
            >
              <div className="font-medium">{date.getDate()}</div>
              {shown.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectProposal(item)}
                  className="mt-1 block w-full truncate rounded bg-blue-100 px-1 text-left text-blue-800"
                >
                  {badgeLabel(item)}
                </button>
              ))}
              {overflow > 0 && <div className="mt-1 text-gray-500">+{overflow} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manually verify in the browser**

Temporarily wire `<CalendarMonthGrid proposals={useGroupProposals('<real-group-id>').proposals} onSelectProposal={(p) => console.log(p)} />` into `apps/web/app/(shell)/groups/[groupId]/calendar/page.tsx` (as a client component). Confirm:
- The grid shows a full month, with days outside the month grayed out.
- A proposal appears as a badge on its correct day (cross-check against what you created in Task 8's verification step).
- Prev/Next/Today change the visible month.
- Clicking a badge logs the right proposal object to the console.
- (Optional, if you have more than 3 items on one day) the "+N more" cutoff appears.

Revert the temporary wiring afterward — commit only the new component file.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/calendar-month-grid.tsx
git commit -m "feat(web): add read-only monthly calendar grid"
```

---

## Task 10: Frontend — proposal detail panel

**Files:**
- Modify: `apps/web/lib/types.ts`
- Create: `apps/web/hooks/use-proposal-detail.ts`
- Create: `apps/web/hooks/use-group-members.ts`
- Create: `apps/web/components/proposal-detail-panel.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 5), `GET /proposals/:id` (now `{ proposal, rsvps, games }`, Task 3), `GET /groups/:groupId/members` (Task 2).
- Produces: `<ProposalDetailPanel proposalId={string | null} onClose={() => void} />` — consumed by Task 11's pages.

- [ ] **Step 1: Add the remaining types**

Edit `apps/web/lib/types.ts`, adding:

```typescript
export interface Rsvp {
  id: number;
  proposalId: string;
  userId: string;
  status: 'yes' | 'maybe' | 'no';
  availableStart: string | null;
  availableEnd: string | null;
  confirmed: boolean;
}

// Only the fields the detail panel actually displays — apps/api/src/games/
// game.entity.ts has several more that the UI doesn't need yet.
export interface ProposalGameSummary {
  game: { id: number; name: string };
  voteCount: number;
}

export interface ProposalDetail {
  proposal: Proposal;
  rsvps: Rsvp[];
  games: ProposalGameSummary[];
}

export interface GroupMemberInfo {
  userId: string;
  displayName: string;
}
```

- [ ] **Step 2: Add the detail hook**

Create `apps/web/hooks/use-proposal-detail.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { ProposalDetail } from '@/lib/types';

interface UseProposalDetailResult {
  detail: ProposalDetail | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  retry: () => void;
}

// Deliberately separate from the panel's JSX (proposal-detail-panel.tsx) —
// see the design spec's non-goal note: future interactive controls (RSVP,
// vote, host) will consume this same fetched shape and trigger a refetch,
// rather than requiring the read-only panel to be rewritten.
export function useProposalDetail(proposalId: string | null): UseProposalDetailResult {
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!proposalId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);

    apiFetch(`/proposals/${proposalId}`)
      .then((response) => {
        if (response.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        return response.json();
      })
      .then((data: ProposalDetail | null) => {
        if (!cancelled && data) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this proposal');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [proposalId, refreshKey]);

  return { detail, loading, notFound, error, retry: () => setRefreshKey((k) => k + 1) };
}
```

- [ ] **Step 3: Add the group members hook**

Create `apps/web/hooks/use-group-members.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { GroupMemberInfo } from '@/lib/types';

// The panel doesn't know ahead of time which group a proposal belongs to
// (in the aggregate space, it could be any of the user's groups) — so it
// fetches members for whichever group the loaded proposal turns out to
// belong to, rather than requiring a caller to plumb a groupId through.
export function useGroupMembers(groupId: string | null): GroupMemberInfo[] {
  const [members, setMembers] = useState<GroupMemberInfo[]>([]);

  useEffect(() => {
    if (!groupId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    apiFetch(`/groups/${groupId}/members`)
      .then((res) => res.json())
      .then((data: GroupMemberInfo[]) => {
        if (!cancelled) setMembers(data);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return members;
}
```

- [ ] **Step 4: Build the panel**

Create `apps/web/components/proposal-detail-panel.tsx`:

```tsx
'use client';

import { useProposalDetail } from '@/hooks/use-proposal-detail';
import { useGroupMembers } from '@/hooks/use-group-members';

interface ProposalDetailPanelProps {
  proposalId: string | null;
  onClose: () => void;
}

export function ProposalDetailPanel({ proposalId, onClose }: ProposalDetailPanelProps) {
  const { detail, loading, notFound, error, retry } = useProposalDetail(proposalId);
  const members = useGroupMembers(detail?.proposal.groupId ?? null);

  if (!proposalId) return null;

  function nameFor(userId: string): string {
    return members.find((m) => m.userId === userId)?.displayName ?? userId;
  }

  return (
    <div className="fixed inset-y-0 right-0 w-80 overflow-y-auto border-l border-gray-200 bg-white p-4 shadow-lg">
      <button type="button" onClick={onClose} className="mb-2 text-sm text-gray-500">
        Close ✕
      </button>

      {loading && <p>Loading…</p>}
      {notFound && <p>This item is no longer available.</p>}
      {error && (
        <p className="text-red-600">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}

      {detail && (
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-semibold">{detail.proposal.proposedDate}</div>
            <div className="text-gray-600">Status: {detail.proposal.status}</div>
            <div className="text-gray-600">Proposed by: {nameFor(detail.proposal.createdBy)}</div>
            {detail.proposal.hostId && (
              <div className="text-gray-600">Host: {nameFor(detail.proposal.hostId)}</div>
            )}
          </div>

          <div>
            <div className="font-medium">RSVPs</div>
            <ul>
              {detail.rsvps.map((rsvp) => (
                <li key={rsvp.userId}>
                  {nameFor(rsvp.userId)} — {rsvp.status}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="font-medium">Suggested games</div>
            <ul>
              {detail.games.map(({ game, voteCount }) => (
                <li key={game.id}>
                  {game.name} ({voteCount} vote{voteCount === 1 ? '' : 's'})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Manually verify in the browser**

Temporarily wire `<ProposalDetailPanel proposalId="<a real proposal id>" onClose={() => {}} />` into a page. Confirm:
- The panel shows the proposal's date, status, proposer (as a real name, not a raw Keycloak sub), RSVPs, and suggested games with vote counts.
- Passing a made-up UUID shows "This item is no longer available."
- Temporarily breaking the URL in `apiFetch` (or stopping the API) shows the error text with a working "Retry" link.

Revert the temporary wiring afterward — commit only the new files.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/types.ts apps/web/hooks/use-proposal-detail.ts apps/web/hooks/use-group-members.ts apps/web/components/proposal-detail-panel.tsx
git commit -m "feat(web): add read-only proposal detail panel"
```

---

## Task 11: Frontend — wire the calendar pages together

**Files:**
- Modify: `apps/web/app/(shell)/calendar/page.tsx`
- Modify: `apps/web/app/(shell)/groups/[groupId]/calendar/page.tsx`
- Create: `apps/web/components/group-calendar-view.tsx`

**Interfaces:**
- Consumes: `useAggregateProposals`, `useGroupProposals` (Task 8), `<CalendarMonthGrid>` (Task 9), `<ProposalDetailPanel>` (Task 10).
- Produces: the finished feature — no further tasks depend on this one.

- [ ] **Step 1: Replace the personal calendar stub**

Replace the contents of `apps/web/app/(shell)/calendar/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useAggregateProposals } from '@/hooks/use-proposals';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { ProposalDetailPanel } from '@/components/proposal-detail-panel';

export default function PersonalCalendarPage() {
  const { proposals, loading, error, retry } = useAggregateProposals();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div>
      {loading && <p>Loading your schedule…</p>}
      {error && (
        <p className="text-red-600">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}
      <CalendarMonthGrid proposals={proposals} onSelectProposal={(proposal) => setSelectedId(proposal.id)} />
      <ProposalDetailPanel proposalId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Build the group calendar client view**

Create `apps/web/components/group-calendar-view.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useGroupProposals } from '@/hooks/use-proposals';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { ProposalDetailPanel } from '@/components/proposal-detail-panel';

export function GroupCalendarView({ groupId }: { groupId: string }) {
  const { proposals, loading, error, retry } = useGroupProposals(groupId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div>
      {loading && <p>Loading this group&apos;s schedule…</p>}
      {error && (
        <p className="text-red-600">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}
      <CalendarMonthGrid proposals={proposals} onSelectProposal={(proposal) => setSelectedId(proposal.id)} />
      <ProposalDetailPanel proposalId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
```

- [ ] **Step 3: Replace the group calendar stub**

`params: Promise<{ groupId: string }>` + `await params` in an async Server Component page is the confirmed current convention for this installed Next.js version (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`) — no further verification needed.

Replace the contents of `apps/web/app/(shell)/groups/[groupId]/calendar/page.tsx`:

```tsx
import { GroupCalendarView } from '@/components/group-calendar-view';

export default async function GroupCalendarPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return <GroupCalendarView groupId={groupId} />;
}
```

(Keeping this page a Server Component that immediately hands off to a plain-prop Client Component sidesteps any ambiguity about whether a Client Component page can itself receive `params` as a `Promise` in this Next.js version.)

- [ ] **Step 4: Full golden-path manual verification**

Run `npm run dev --workspace=apps/web`, log in, and walk through the whole feature:
1. Land on `/calendar` (personal space) — confirm real proposals from every group you belong to appear, each badge tagged with its source group's name.
2. Switch to a specific real group via the switcher — confirm the URL becomes `/groups/<id>/calendar`, only that group's proposals show, and badges are no longer group-tagged.
3. Switch to your solo group ("Just Me") — confirm an empty grid (no error) if you haven't logged anything there.
4. Click a badge — confirm the detail panel opens with the right date/status/host/RSVPs (real names)/suggested games, and close it.
5. Click a badge for a day with more than `MAX_BADGES_PER_DAY` items (create test proposals via `curl` if needed) — confirm "+N more" appears and the shown badges are still clickable.
6. Navigate Prev/Next/Today — confirm the grid updates and badge placement stays correct across month boundaries.
7. Click "Log out" — confirm redirect to login, and that revisiting `/calendar` afterward redirects to login instead of showing stale data.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(shell)/calendar/page.tsx" "apps/web/app/(shell)/groups/[groupId]/calendar/page.tsx" apps/web/components/group-calendar-view.tsx
git commit -m "feat(web): wire the calendar grid and detail panel into both spaces"
```

---

## Post-implementation: reference doc

Once this plan is fully implemented and verified, write `docs/reference/frontend-architecture.md` (a new topic — none exists yet) describing the shell's actual routing structure, the two-space model, and the `apiFetch`/token-refresh pattern as built, then mirror it to a Plane Page attached to this feature's work item (`BGGG-14`) per `feature-dev-skill`'s Step 2.3 process. This was deliberately deferred until after implementation (see the design spec) since documenting "current behavior" before the code exists would just describe a plan, not a subsystem.
