import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FILE_STORAGE } from '../../../shared/contracts/tokens';
import { FileStorage } from '../../../shared/contracts/file-storage.port';

// Decisão confirmada com o usuário: "espelhar os arquivos", não só guardar
// a URL do Olist (docs/erp-integration-architecture.md, seção 8). Baixa
// cada foto (GET — mesma garantia de leitura da seção 4) e persiste uma
// cópia via a porta FileStorage, retornando URLs hospedadas pela própria
// Precifica. Resiliência parcial: uma foto que falhar não derruba o produto
// inteiro — só fica de fora do array final, com um warning no log.
@Injectable()
export class ProductPhotoMirrorService {
  private readonly logger = new Logger(ProductPhotoMirrorService.name);

  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  async mirrorAll(tenantId: string, skuCode: string, sourceUrls: string[]): Promise<string[]> {
    const mirrored: string[] = [];
    for (let index = 0; index < sourceUrls.length; index++) {
      const sourceUrl = sourceUrls[index];
      try {
        const mirroredUrl = await this.mirrorOne(tenantId, skuCode, index, sourceUrl);
        mirrored.push(mirroredUrl);
      } catch (error) {
        this.logger.warn(`Falha ao espelhar foto ${index} de ${skuCode} (${sourceUrl}): ${(error as Error).message}`);
      }
    }
    return mirrored;
  }

  private async mirrorOne(tenantId: string, skuCode: string, index: number, sourceUrl: string): Promise<string> {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`GET ${sourceUrl} retornou HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    const ext = extensionFromContentType(contentType);
    const urlFingerprint = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 10);
    const key = `products/${tenantId}/${skuCode}/${index}-${urlFingerprint}.${ext}`;

    const stored = await this.storage.upload(key, buffer, contentType);
    return stored.url;
  }
}

function extensionFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}
