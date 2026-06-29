import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditEvent {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  // NestJS's built-in Logger is used here — not Pino directly — because
  // at this point in the session NestJS hasn't been wired to Pino yet.
  // Once main.ts is updated (next step), this Logger instance will
  // automatically route through Pino. No change needed here.
  private readonly logger = new Logger(AuditService.name);

  constructor(
    // InjectRepository scopes the TypeORM repository to the AuditLog entity.
    // This is only available because AuditModule imports
    // TypeOrmModule.forFeature([AuditLog]) — without that import, this
    // injection would throw at startup.
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  // Single entry point for all audit events in the application.
  // Callers pass a plain object; this method handles persistence and logging.
  //
  // Decision: this method does NOT accept an EntityManager parameter (i.e. it
  // does not participate in the caller's transaction). Instead it inserts via
  // its own repository connection.
  //
  // Why: most callers (guards, interceptors) do not have an open transaction.
  // For the cases that do (e.g. a service that also writes business data),
  // the audit INSERT landing in its own auto-commit is acceptable — we prefer
  // a guaranteed audit record over strict atomicity at this stage.
  // The worked example in the learning note shows the fully atomic pattern for
  // cases where you need both-or-nothing guarantees.
  async log(event: AuditEvent): Promise<void> {
    try {
      await this.auditRepo.save({
        actorId: event.actorId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: event.metadata ?? null,
      });

      // Emit a structured Pino log line alongside the DB write.
      // The DB row is the durable record; this line feeds the ops stream
      // (stdout → log shipper → Loki in Phase 5).
      this.logger.log({
        msg: 'audit',
        ...event,
      });
    } catch (err) {
      // If the audit INSERT fails, we log the error but do NOT re-throw.
      // Re-throwing would cause the caller's HTTP request to fail, which
      // is a worse outcome than a missing audit row. Missing rows should
      // trigger an alert in Phase 5 (via a Loki rule on 'audit_write_failed').
      this.logger.error({ msg: 'audit_write_failed', event, err });
    }
  }
}
