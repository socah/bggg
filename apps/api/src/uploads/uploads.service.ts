import { ForbiddenException, Injectable } from '@nestjs/common';
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
    // Key is generated here, from the authenticated user's id — dto never
    // supplies a key. This is the step that actually enforces "you can only
    // request an upload URL for a path under your own user id".
    const key = this.r2Service.buildObjectKey(userId);
    const { url, expiresIn } = await this.r2Service.createPresignedUploadUrl(
      key,
      dto.contentType,
    );

    return { url, key, expiresIn };
  }

  async confirm(userId: string, dto: ConfirmUploadDto): Promise<PlayPhoto> {
    // Defense in depth: even though buildObjectKey() only ever produces keys
    // under play-photos/<userId>/..., nothing stops a client from calling
    // /uploads/confirm with an arbitrary key string it didn't get from a
    // real presign response (e.g. someone else's key, copied from a shared
    // link). This check makes sure the key this user is confirming actually
    // belongs to them before a row is written — without it, User A could
    // attach a row (and audit trail) claiming ownership of User B's photo.
    if (!dto.key.startsWith(`play-photos/${userId}/`)) {
      throw new ForbiddenException('This upload key does not belong to you');
    }

    const photo = this.playPhotoRepository.create({
      sessionId: dto.sessionId,
      uploadedBy: userId,
      key: dto.key,
      url: this.r2Service.buildPublicUrl(dto.key),
    });

    return this.playPhotoRepository.save(photo);
  }
}
