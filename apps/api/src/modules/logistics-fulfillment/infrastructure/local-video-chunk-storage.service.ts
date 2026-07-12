import { Injectable, Logger } from '@nestjs/common';
import { appendFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { VideoChunkAppendResult, VideoChunkStorage } from '../application/ports/video-chunk-storage.port';

// Sprint 27 (Pick & Pack) — implementação de disco local do VideoChunkStorage.
// Reaproveita a MESMA raiz de disco do LocalFileStorageService (ERP_STORAGE_ROOT)
// e, portanto, o MESMO ServeStaticModule já registrado em app.module.ts
// (rootPath=STORAGE_ROOT, serveRoot='/uploads') — nenhuma rota estática nova
// precisa ser cadastrada; storageKey já vem prefixado com
// "logistics-fulfillment/video-capture/..." (ver VideoCaptureService.startSession),
// então o arquivo cai em <STORAGE_ROOT>/logistics-fulfillment/video-capture/...
// e fica acessível em /uploads/logistics-fulfillment/video-capture/....
//
// Trocável por um adapter S3/R2 (multipart upload) em produção com múltiplas
// instâncias sem disco compartilhado — mesma razão documentada em
// LocalFileStorageService; ver docs/pick-pack-architecture.md, seção 2.
const STORAGE_ROOT = process.env.ERP_STORAGE_ROOT ?? join(process.cwd(), 'storage', 'uploads');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

@Injectable()
export class LocalVideoChunkStorageService implements VideoChunkStorage {
  private readonly logger = new Logger(LocalVideoChunkStorageService.name);

  async createSession(key: string): Promise<void> {
    const filePath = join(STORAGE_ROOT, key);
    await mkdir(dirname(filePath), { recursive: true });
    // Cria o arquivo vazio — todo chunk subsequente é um append, nunca uma
    // reescrita do zero (garante que uma falha no meio da gravação perde só
    // o chunk em trânsito, nunca os já commitados).
    await writeFile(filePath, Buffer.alloc(0), { flag: 'w' });
  }

  async appendChunk(key: string, content: Buffer): Promise<VideoChunkAppendResult> {
    const filePath = join(STORAGE_ROOT, key);
    await appendFile(filePath, content);
    return { totalBytes: content.length };
  }

  // Disco local: cada chunk já foi commitado via append no momento em que
  // chegou (appendChunk acima) — não existe nenhum passo de "completar"
  // pendente, ao contrário do multipart upload do adapter R2
  // (R2VideoChunkStorageService, que só materializa o objeto no bucket após
  // um CompleteMultipartUpload explícito). Este método existe só para
  // satisfazer a porta com paridade de comportamento entre os dois adapters.
  async finalizeSession(key: string): Promise<string> {
    return this.getPublicUrl(key);
  }

  getPublicUrl(key: string): string {
    return `${PUBLIC_BASE_URL}/uploads/${key}`;
  }

  // Idempotente: apagar um arquivo que já não existe (job de limpeza rodando
  // duas vezes sobre a mesma sessão, por qualquer motivo) não deve lançar —
  // é o estado final desejado, não um erro.
  async delete(key: string): Promise<void> {
    const filePath = join(STORAGE_ROOT, key);
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.debug(`Arquivo de vídeo ${key} já não existia — delete idempotente, ignorado.`);
        return;
      }
      throw error;
    }
  }
}
