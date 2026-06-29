import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BggService } from './bgg.service';

// BggModule is a feature module — it owns everything related to talking to BGG.
// Any other module that needs BggService imports BggModule (not BggService directly).
@Module({
  imports: [
    // HttpModule registers HttpService as a provider in this module's scope.
    // Without this import, injecting HttpService into BggService would throw
    // "Nest can't resolve dependencies of the BggService" at startup.
    HttpModule,
  ],
  providers: [BggService],
  // exports makes BggService available to any module that imports BggModule.
  // Without exports, BggService is private to this module — GamesModule
  // (which we build next) would not be able to inject it.
  exports: [BggService],
})
export class BggModule {}
