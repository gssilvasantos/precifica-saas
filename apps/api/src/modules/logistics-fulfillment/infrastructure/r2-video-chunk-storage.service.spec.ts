import { R2VideoChunkStorageService } from './r2-video-chunk-storage.service';
import { resetR2ClientForTests } from '../../../shared/infrastructure/storage/r2-client.factory';

// Mock manual do @aws-sdk/client-s3 — sem rede real neste sandbox. Cada
// Command é uma classe simples que só guarda o input; o S3Client fake
// decide a resposta por NOME da classe do comando, permitindo testar o
// fluxo completo de multipart upload (create -> uploadPart(s) -> complete)
// sem tocar rede — mesmo racional documentado no adapter (ver comentário de
// cabeçalho de r2-video-chunk-storage.service.ts).
let sendMock: jest.Mock;

jest.mock('@aws-sdk/client-s3', () => {
  class FakeCommand {
    constructor(public input: any) {}
  }
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: (...args: any[]) => sendMock(...args),
    })),
    CreateMultipartUploadCommand: class extends FakeCommand {},
    UploadPartCommand: class extends FakeCommand {},
    CompleteMultipartUploadCommand: class extends FakeCommand {},
    DeleteObjectCommand: class extends FakeCommand {},
  };
});

const ENV = {
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_ACCESS_KEY: 'key',
  R2_SECRET_KEY: 'secret',
  R2_BUCKET: 'bucket-test',
  R2_PUBLIC_BASE_URL: 'https://pub-test.r2.dev',
};

describe('R2VideoChunkStorageService', () => {
  let service: R2VideoChunkStorageService;
  let uploadPartInputs: any[];
  let completeCalls: any[];

  beforeEach(() => {
    Object.entries(ENV).forEach(([key, value]) => {
      process.env[key] = value;
    });
    resetR2ClientForTests();

    uploadPartInputs = [];
    completeCalls = [];
    let partCounter = 0;

    sendMock = jest.fn(async (command: any) => {
      const name = command.constructor.name;
      if (name === 'CreateMultipartUploadCommand') {
        return { UploadId: 'upload-123' };
      }
      if (name === 'UploadPartCommand') {
        partCounter += 1;
        uploadPartInputs.push(command.input);
        return { ETag: `etag-${partCounter}` };
      }
      if (name === 'CompleteMultipartUploadCommand') {
        completeCalls.push(command.input);
        return {};
      }
      if (name === 'DeleteObjectCommand') {
        return {};
      }
      throw new Error(`[teste] comando não esperado enviado ao S3Client fake: ${name}`);
    });

    service = new R2VideoChunkStorageService();
  });

  afterEach(() => {
    Object.keys(ENV).forEach((key) => delete process.env[key]);
  });

  it('bufferiza chunks pequenos em memória e só sobe uma Part real ao atingir o mínimo de 5 MiB do S3/R2', async () => {
    const key = 'logistics-fulfillment/video-capture/tenant-1/event-1.webm';
    await service.createSession(key);

    const oneMiB = Buffer.alloc(1024 * 1024, 'a');
    for (let i = 0; i < 4; i += 1) {
      const result = await service.appendChunk(key, oneMiB);
      expect(result.totalBytes).toBe(oneMiB.length * (i + 1));
    }
    expect(uploadPartInputs).toHaveLength(0); // 4 MiB acumulados, ainda abaixo do mínimo

    await service.appendChunk(key, oneMiB); // 5º MiB -> total 5 MiB, dispara o flush
    expect(uploadPartInputs).toHaveLength(1);
    expect(uploadPartInputs[0].PartNumber).toBe(1);
    expect(uploadPartInputs[0].UploadId).toBe('upload-123');
    expect((uploadPartInputs[0].Body as Buffer).length).toBe(5 * 1024 * 1024);
  });

  it('finalizeSession sobe o restante do buffer como Part final (mesmo abaixo de 5 MiB) e completa o multipart upload', async () => {
    const key = 'logistics-fulfillment/video-capture/tenant-1/event-2.webm';
    await service.createSession(key);
    await service.appendChunk(key, Buffer.alloc(100, 'x')); // bem menor que 5 MiB

    const url = await service.finalizeSession(key);

    expect(uploadPartInputs).toHaveLength(1);
    expect((uploadPartInputs[0].Body as Buffer).length).toBe(100);
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0].MultipartUpload.Parts).toEqual([{ ETag: 'etag-1', PartNumber: 1 }]);
    expect(url).toBe(`${ENV.R2_PUBLIC_BASE_URL}/${key}`);
  });

  it('finalizeSession com múltiplas Parts já commitadas: completa com todas na ordem certa', async () => {
    const key = 'logistics-fulfillment/video-capture/tenant-1/event-3.webm';
    await service.createSession(key);
    const fiveMiB = Buffer.alloc(5 * 1024 * 1024, 'b');
    await service.appendChunk(key, fiveMiB); // flush automático da Part 1
    await service.appendChunk(key, Buffer.alloc(50, 'c')); // sobra para a Part final

    await service.finalizeSession(key);

    expect(uploadPartInputs).toHaveLength(2);
    expect(completeCalls[0].MultipartUpload.Parts).toEqual([
      { ETag: 'etag-1', PartNumber: 1 },
      { ETag: 'etag-2', PartNumber: 2 },
    ]);
  });

  it('appendChunk sem createSession prévio: lança erro explícito em vez de um NPE genérico', async () => {
    await expect(service.appendChunk('key-nao-iniciada', Buffer.from('x'))).rejects.toThrow(/não foi inicializada/);
  });

  it('delete: envia DeleteObjectCommand para o bucket/key configurados', async () => {
    const key = 'logistics-fulfillment/video-capture/tenant-1/event-4.webm';
    await service.delete(key);

    const deleteCall = sendMock.mock.calls.find(([cmd]: any) => cmd.constructor.name === 'DeleteObjectCommand');
    expect(deleteCall).toBeTruthy();
    expect(deleteCall![0].input).toEqual({ Bucket: ENV.R2_BUCKET, Key: key });
  });
});
