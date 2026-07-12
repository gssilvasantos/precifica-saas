import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getR2Client } from '../../../../shared/infrastructure/storage/r2-client.factory';
import { requireStorageEnv } from '../../../../shared/infrastructure/storage/r2-env';
import { FileStorage, StoredFile } from '../../../../shared/contracts/file-storage.port';

// Passo 3 do Deploy Demo — implementação R2 da porta FileStorage (mesma
// interface de LocalFileStorageService, ver shared/contracts/file-storage.port.ts).
// Trocável em runtime via storage-environment.ts/resolveStorageDriver() — o
// consumidor (ProductPhotoMirrorService) não muda uma linha.
//
// Diferente do VideoChunkStorage (R2VideoChunkStorageService), aqui um
// PutObjectCommand simples basta: `content` já chega inteiro em memória
// (foto de produto, poucos MB no máximo) — nenhum motivo para multipart
// upload, que só compensa a partir de objetos grandes/streamados.
@Injectable()
export class R2FileStorageService implements FileStorage {
  private readonly logger = new Logger(R2FileStorageService.name);

  async upload(key: string, content: Buffer, contentType: string): Promise<StoredFile> {
    const bucket = requireStorageEnv('R2_BUCKET');
    // R2_PUBLIC_BASE_URL é a URL pública de LEITURA do bucket (domínio custom
    // vinculado no painel do R2, ou o "Public Development URL" tipo
    // https://pub-xxxxxxxx.r2.dev) — NUNCA o R2_ENDPOINT (esse é só a API S3
    // autenticada, não serve GET público). Ver docs/deploy-render-supabase-r2.md,
    // seção 3.1.
    const publicBaseUrl = requireStorageEnv('R2_PUBLIC_BASE_URL');

    await getR2Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
      }),
    );

    const url = `${publicBaseUrl.replace(/\/$/, '')}/${key}`;
    this.logger.debug(`Arquivo enviado ao R2: ${key} -> ${url}`);
    return { url, key };
  }
}
