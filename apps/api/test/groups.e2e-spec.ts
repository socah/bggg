import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import request, { Response } from 'supertest';
import { GroupsController } from '../src/groups/groups.controller';
import { GroupsService } from '../src/groups/groups.service';
import { AuthGuard } from '../src/auth/auth.guard';
import { Group } from '../src/groups/group.entity';

// Fixed, valid-format UUIDs — GroupsController's :id param goes through
// ParseUUIDPipe now (not ParseIntPipe, despite what this file's tests used
// to assume), so route params below have to be UUID-shaped even though the
// mocked service never actually looks them up.
const TEST_USER_ID = 'a1111111-1111-4111-8111-111111111111';
const GROUP_ID = 'b2222222-2222-4222-8222-222222222222';
const OTHER_GROUP_ID = 'c3333333-3333-4333-8333-333333333333';

describe('Groups (e2e)', () => {
  let app: INestApplication;

  const mockGroupsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeAll(async () => {
    // e2e tests use beforeAll (not beforeEach) so the app boots once and
    // stays running for all tests — booting NestJS is expensive compared to
    // a single test.
    // We register only GroupsController — no AppModule, no TypeOrmModule.
    // Importing AppModule would trigger TypeOrmModule.forRoot() which tries to
    // connect to Postgres. Since we're mocking the service, the database is
    // not needed; bringing it in would just add a slow, fragile dependency.
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupsController],
      providers: [
        { provide: GroupsService, useValue: mockGroupsService },
      ],
    })
      // .overrideGuard replaces AuthGuard wherever @UseGuards(AuthGuard)
      // appears, without needing to import or register it as a provider.
      // Unlike a bare '() => true', this also stamps req.user the same way
      // the real AuthGuard does after verifying a JWT — every handler below
      // reads req.user.sub as the requesting user, so without this they'd
      // throw on a real request, not just return the wrong thing.
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          request.user = { sub: TEST_USER_ID };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();

    // Apply the same global ValidationPipe that runs in production (main.ts).
    // Without this, the e2e tests would not catch validation failures, making
    // them less representative of real behaviour.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

    // init() starts the HTTP server internally — no port is bound; supertest
    // communicates with it directly via the underlying http.Server instance.
    await app.init();
  });

  afterAll(async () => {
    // Close the app after all tests to release the HTTP server and any open
    // connections. Without this, Jest may hang after the suite finishes.
    await app.close();
  });

  afterEach(() => jest.clearAllMocks());

  // ── GET /groups ───────────────────────────────────────────────────────────

  it('GET /groups → 200 with array', async () => {
    const groups: Group[] = [
      { id: GROUP_ID, name: 'Chess Club', ownerId: TEST_USER_ID, isSolo: false, createdAt: new Date() },
    ];
    mockGroupsService.findAll.mockResolvedValue(groups);

    // request(app.getHttpServer()) creates a supertest agent bound to the
    // NestJS HTTP server. .get('/groups') sends a real GET request through
    // the full middleware + guard + controller + pipe stack.
    await request(app.getHttpServer())
      .get('/groups')
      .expect(200)
      .expect((res: Response) => {
        expect(res.body).toHaveLength(1);
        expect(res.body[0].name).toBe('Chess Club');
      });
  });

  // ── GET /groups/:id ───────────────────────────────────────────────────────

  it('GET /groups/:id → 200 with group', async () => {
    const group: Group = { id: GROUP_ID, name: 'Chess Club', ownerId: TEST_USER_ID, isSolo: false, createdAt: new Date() };
    mockGroupsService.findOne.mockResolvedValue(group);

    await request(app.getHttpServer())
      .get(`/groups/${GROUP_ID}`)
      .expect(200)
      .expect((res: Response) => {
        expect(res.body.name).toBe('Chess Club');
      });
  });

  it('GET /groups/:id → 404 when not found', async () => {
    // NestJS's built-in exception filter catches NotFoundException and maps
    // it to a 404 response. This test confirms that mapping is in place.
    const { NotFoundException } = await import('@nestjs/common');
    mockGroupsService.findOne.mockRejectedValue(new NotFoundException());

    await request(app.getHttpServer()).get(`/groups/${OTHER_GROUP_ID}`).expect(404);
  });

  it('GET /groups/:id → 400 when id is not a UUID', async () => {
    // ParseUUIDPipe rejects malformed route params with 400 Bad Request.
    // This test verifies the pipe is wired correctly — it would pass even
    // without any service mock because the pipe runs before the service.
    await request(app.getHttpServer()).get('/groups/not-a-uuid').expect(400);
  });

  // ── POST /groups ──────────────────────────────────────────────────────────

  it('POST /groups → 201 with created group', async () => {
    const created: Group = { id: GROUP_ID, name: 'Go Club', ownerId: TEST_USER_ID, isSolo: false, createdAt: new Date() };
    mockGroupsService.create.mockResolvedValue(created);

    await request(app.getHttpServer())
      .post('/groups')
      .send({ name: 'Go Club' })
      .expect(201)
      .expect((res: Response) => {
        expect(res.body.id).toBe(GROUP_ID);
        expect(res.body.name).toBe('Go Club');
      });
  });

  // ── DELETE /groups/:id ────────────────────────────────────────────────────

  it('DELETE /groups/:id → 204 no content', async () => {
    mockGroupsService.remove.mockResolvedValue(undefined);

    await request(app.getHttpServer()).delete(`/groups/${GROUP_ID}`).expect(204);
  });
});
