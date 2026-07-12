import { R2FileStorageService } from './r2-file-storage.service';
import { resetR2ClientForTests } from '../../../../shared/infrastructure/storage/r2-client.factory';

// Mock manual do @aws-sdk/client-s3 — sem rede real neste sandbox (mesma
// razão documentada em todo o projeto para o engine do Prisma/binários
// externos: ver docs/deploy-render-supabase-r2.md). Cada Command é uma
// classe simples que só guarda o input recebido; o S3Client fake devolve o
// que o teste configurar em `sendMock`.
let sendMock: jest.Mock;

jest.mock('@aws-sdk/client-s3', () => {
  class FakeCommand {
    constructor(public input: unknown) {}
  }
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => sendMock(...args),
    })),
    PutObjectCommand: class extends FakeCommand {},
  };
});

describe('R2FileStorageService', () => {
  const ENV = {
    R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    R2_ACCESS_KEY: 'key',
    R2_SECRET_KEY: 'secret',
    R2_BUCKET: 'bucket-test',
    R2_PUBLIC_BASE_URL: 'https://pub-test.r2.dev/',
  };

  beforeEach(() => {
    Object.entries(ENV).forEach(([key, value]) => {
      process.env[key] = value;
    });
    resetR2ClientForTests();
    sendMock = jest.fn().mockResolvedValue({});
  });

  afterEach(() => {
    Object.keys(ENV).forEach((key) => delete process.env[key]);
  });

  it('envia PutObjectCommand com o conteúdo e monta a URL pública a partir de R2_PUBLIC_BASE_URL (barra final removida)', async () => {
    const service = new R2FileStorageService();
    const content = Buffer.from('foto-fake');

    const result = await service.upload('erp-integration/products/sku-1.jpg', content, 'image/jpeg');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [command] = sendMock.mock.calls[0] as [{ input: unknown }];
    expect(command.input).toEqual({
      Bucket: 'bucket-test',
      Key: 'erp-integration/products/sku-1.jpg',
      Body: content,
      ContentType: 'image/jpeg',
    });
    expect(result).toEqual({
      url: 'https://pub-test.r2.dev/erp-integration/products/sku-1.jpg',
      key: 'erp-integration/products/sku-1.jpg',
    });
  });

  it('sem R2_BUCKET configurado: lança erro explícito em vez de deixar o SDK falhar por baixo', async () => {
    delete process.env.R2_BUCKET;
    const service = new R2FileStorageService();

    await expect(service.upload('k', Buffer.from('x'), 'image/png')).rejects.toThrow(/R2_BUCKET/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sem R2_PUBLIC_BASE_URL configurado: lança erro explícito', async () => {
    delete process.env.R2_PUBLIC_BASE_URL;
    const service = new R2FileStorageService();

    await expect(service.upload('k', Buffer.from('x'), 'image/png')).rejects.toThrow(/R2_PUBLIC_BASE_URL/);
  });
});
