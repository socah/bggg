import { describe, expect, it, jest } from '@jest/globals';

process.env.R2_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET = 'test-bucket';

const { R2Service } = await import('./r2.service');

describe('R2Service', () => {
  it('does not sign an empty-body checksum into browser upload URLs', async () => {
    const service = new R2Service();

    const { url } = await service.createPresignedUploadUrl(
      'play-photos/user-1/photo',
      'image/webp',
      5,
    );

    const params = new URL(url).searchParams;
    expect(params.has('x-amz-checksum-crc32')).toBe(false);
    expect(params.has('x-amz-sdk-checksum-algorithm')).toBe(false);
    expect(params.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('checks actual object sizes against the upload limit', () => {
    const service = new R2Service();

    expect(service.isUploadSizeAllowed(10 * 1024 * 1024)).toBe(true);
    expect(service.isUploadSizeAllowed(10 * 1024 * 1024 + 1)).toBe(false);
  });

  it('uploads API-received bytes with their validated content type', async () => {
    const service = new R2Service();
    const client = service as unknown as {
      client: { send(command: unknown): Promise<unknown> };
    };
    const send = jest.spyOn(client.client, 'send').mockResolvedValue({});
    const body = Buffer.from('photo');

    await service.uploadObject('play-photos/user-1/photo', 'image/webp', body);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual(expect.objectContaining({
      input: {
        Bucket: 'test-bucket',
        Key: 'play-photos/user-1/photo',
        ContentType: 'image/webp',
        Body: body,
      },
    }));
  });
});
