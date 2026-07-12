import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FileStorage, StoredFile } from '../../../../shared/contracts/file-storage.port';

// Implementação inicial da porta FileStorage: disco local, servido como
// estático pelo Nest via ServeStaticModule (ver app.module.ts, rootPath
// apontando para o mesmo STORAGE_ROOT, serveRoot '/uploads'). Suficiente
// para dev/self-host de um único servidor; trocável por S3/R2/GCS quando o
// deploy precisar de múltiplas instâncias sem disco compartilhado — basta
// escrever outra classe implementando FileStorage e trocar o binding no
// módulo, nenhum consumidor muda (docs/erp-integration-architecture.md,
// seção 8).
const STORAGE_ROOT = process.env.ERP_STORAGE_ROOT ?? join(process.cwd(), 'storage', 'uploads');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

@Injectable()
export class LocalFileStorageService implements FileStorage {
  private readonly logger = new Logger(LocalFileStorageService.name);

  async upload(key: string, content: Buffer, _contentType: string): Promise<StoredFile> {
    const filePath = join(STORAGE_ROOT, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    const url = `${PUBLIC_BASE_URL}/uploads/${key}`;
    this.logger.debug(`Arquivo espelhado: ${key} -> ${url}`);
    return { url, key };
  }
}
