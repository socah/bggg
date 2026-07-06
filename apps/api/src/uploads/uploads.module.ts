import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayPhoto } from './play-photo.entity';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { R2Service } from './r2.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlayPhoto])],
  controllers: [UploadsController],
  // R2Service is only needed within this module for now — not exported,
  // since no other module talks to R2 yet.
  providers: [UploadsService, R2Service],
  exports: [UploadsService],
})
export class UploadsModule {}
