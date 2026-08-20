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
    //
    // validateStatus: () => true — axios defaults to rejecting anything
    // outside 2xx, which meant BggService's `response.status === 202` /
    // `!== 200` branches could never run against a real BGG 429 or 5xx: the
    // observable rejected with a raw AxiosError first, so the intended
    // HttpException pass-through never happened. Resolving for every status
    // hands the status back to the code that already knows what to do with it.
    //
    // timeout — BGG can hang; a bounded per-request timeout keeps one stuck
    // socket from tying up a request indefinitely. This is per HTTP call, so
    // it doesn't cap fetchWithPolling's own (deliberate) multi-attempt wait.
    HttpModule.register({ validateStatus: () => true, timeout: 10000 }),
  ],
  providers: [BggService],
  // exports makes BggService available to any module that imports BggModule.
  // Without exports, BggService is private to this module — GamesModule
  // (which we build next) would not be able to inject it.
  exports: [BggService],
})
export class BggModule {}
