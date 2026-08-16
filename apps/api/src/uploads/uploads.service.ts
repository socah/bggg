import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlayPhoto } from './play-photo.entity';
import { R2Service } from './r2.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

@Injectable()
export class UploadsService {
  constructor(
    @InjectRepository(PlayPhoto)
    private readonly playPhotoRepository: Repository<PlayPhoto>,
    private readonly r2Service: R2Service,
  ) {}

  async presign(userId: string, dto: PresignUploadDto) {
    // Approximate free-tier storage guard: sum every confirmed photo's real
    // size and check whether this upload would push the bucket over the
    // configured cap before we even bother signing a URL. See
    // R2Service.hasCapacityFor for the race-condition caveat.
    const currentTotalBytes = await this.getTotalStorageBytes();
    if (!this.r2Service.hasCapacityFor(currentTotalBytes, dto.contentLength)) {
      throw new HttpException(
        'R2 storage quota would be exceeded by this upload',
        HttpStatus.INSUFFICIENT_STORAGE,
      );
    }

    // Key is generated here, from the authenticated user's id — dto never
    // supplies a key. This is the step that actually enforces "you can only
    // request an upload URL for a path under your own user id".
    const key = this.r2Service.buildObjectKey(userId);
    const { url, expiresIn } = await this.r2Service.createPresignedUploadUrl(
      key,
      dto.contentType,
      dto.contentLength,
    );

    return { url, key, expiresIn };
  }

  // Return type is PlayPhoto plus a runtime-only `url` — see the presigned
  // GET comment below for why that field is never part of the entity/table
  // itself.
  async confirm(
    userId: string,
    dto: ConfirmUploadDto,
  ): Promise<PlayPhoto & { url: string }> {
    // Defense in depth: even though buildObjectKey() only ever produces keys
    // under play-photos/<userId>/..., nothing stops a client from calling
    // /uploads/confirm with an arbitrary key string it didn't get from a
    // real presign response (e.g. someone else's key, copied from a shared
    // link). This check makes sure the key this user is confirming actually
    // belongs to them before a row is written — without it, User A could
    // attach a row (and audit trail) claiming ownership of User B's photo.
    if (!this.r2Service.keyBelongsToUser(dto.key, userId)) {
      throw new ForbiddenException('This upload key does not belong to you');
    }

    // Without this, confirming a key that was never actually PUT to R2 (a
    // buggy client, an upload that failed partway through, or someone just
    // calling this endpoint directly) would create a play_photos row
    // pointing at a URL that 404s whenever anyone views it. The returned
    // size is R2's own account of what it stored — see PlayPhoto.sizeBytes.
    const head = await this.r2Service.headObject(dto.key);
    if (!head) {
      throw new NotFoundException('No uploaded object found for this key');
    }

    const photo = this.playPhotoRepository.create({
      sessionId: dto.sessionId,
      uploadedBy: userId,
      key: dto.key,
      sizeBytes: head.sizeBytes,
    });

    const saved = await this.playPhotoRepository.save(photo);

    // A presigned GET URL, generated fresh for this response only — never
    // persisted (see PlayPhoto.key's own comment for why). The uploader
    // just proved they're allowed to see this exact photo by uploading it,
    // so no separate membership check is needed here specifically; any
    // FUTURE endpoint that lists/re-displays photos later must run that
    // check itself before calling createPresignedGetUrl again.
    return { ...saved, url: await this.r2Service.createPresignedGetUrl(saved.key) };
  }

  // SUM across every confirmed photo. Cast to bigint in SQL then parsed back
  // to a JS number here — Postgres's SUM(int) returns bigint (driver returns
  // it as a string) to avoid silent overflow on the aggregate, even though
  // any realistic total for this project stays well under
  // Number.MAX_SAFE_INTEGER.
  private async getTotalStorageBytes(): Promise<number> {
    // SUM with no GROUP BY always yields exactly one row (COALESCE keeps it
    // 0 rather than NULL when the table is empty) — getRawOne's return type
    // is nullable only because TypeORM can't express that guarantee.
    const row = await this.playPhotoRepository
      .createQueryBuilder('photo')
      .select('COALESCE(SUM(photo.sizeBytes), 0)', 'total')
      .getRawOne<{ total: string }>();

    return parseInt(row?.total ?? '0', 10);
  }
}
