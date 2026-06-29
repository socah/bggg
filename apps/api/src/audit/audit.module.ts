import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

@Module({
  imports: [
    // Registers the AuditLog repository with TypeORM's DI system for this
    // module's scope. Without this, @InjectRepository(AuditLog) in
    // AuditService would throw "No repository for AuditLog was found".
    TypeOrmModule.forFeature([AuditLog]),
  ],
  providers: [AuditService],
  // Exporting AuditService is what makes it injectable in other modules.
  // Without this export, a module that imports AuditModule would find the
  // import resolves but AuditService is still not in its provider scope —
  // a common NestJS mistake that produces a confusing "unknown dependency"
  // error at startup.
  exports: [AuditService],
})
export class AuditModule {}
