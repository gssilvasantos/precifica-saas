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

  // Devolve também se ALGUMA foto falhou (09/08/2026). Antes só devolvia as
  // que deram certo, e o chamador não tinha como distinguir "produto com 2
  // fotos" de "produto com 5 fotos, 3 das quais falharam" — gravava o
  // contentHash como se tudo tivesse ido bem e, no sync seguinte, o atalho de
  // hash igual pulava o produto. Foto perdida por um erro transitório de rede
  // ficava perdida PARA SEMPRE, até alguém editar o cadastro no Olist.
  async mirrorAll(
    tenantId: string,
    skuCode: string,
    sourceUrls: string[],
  ): Promise<{ urls: string[]; houveFalha: boolean }> {
    const mirrored: string[] = [];
    let houveFalha = false;

    for (let index = 0; index < sourceUrls.length; index++) {
      const sourceUrl = sourceUrls[index];
      try {
        const mirroredUrl = await this.mirrorOne(tenantId, skuCode, index, sourceUrl);
        mirrored.push(mirroredUrl);
      } catch (error) {
        houveFalha = true;
        // Só o host, nunca a URL inteira: se o Olist servir anexo por URL
        // pré-assinada, a query string carrega credencial.
        const origem = hostDe(sourceUrl);
        this.logger.warn(`Falha ao espelhar foto ${index} de ${skuCode} (origem ${origem}): ${(error as Error).message}`);
      }
    }

    return { urls: mirrored, houveFalha };
  }

  private async mirrorOne(tenantId: string, skuCode: string, index: number, sourceUrl: string): Promise<string> {
    // Timeout obrigatório (.claude/rules/backend.md). Sem ele, uma origem que
    // aceita a conexão e nunca responde pendura o sync inteiro sem lançar
    // erro e sem terminar — e este laço roda uma vez por foto, de todo o
    // catálogo, dentro de um processo Node compartilhado por todos os tenants.
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`GET da foto retornou HTTP ${response.status}`);

    // Teto de tamanho: `arrayBuffer()` carrega tudo em memória, e o conteúdo
    // vem de terceiro. Checa o cabeçalho quando ele existe e o tamanho real
    // depois — cabeçalho ausente ou mentiroso é o caso interessante.
    const declarado = Number(response.headers.get('content-length') ?? '0');
    if (declarado > MAX_FOTO_BYTES) {
      throw new Error(`foto de ${declarado} bytes excede o teto de ${MAX_FOTO_BYTES}`);
    }

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_FOTO_BYTES) {
      throw new Error(`foto de ${buffer.byteLength} bytes excede o teto de ${MAX_FOTO_BYTES}`);
    }

    const ext = extensionFromContentType(contentType);
    const urlFingerprint = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 10);
    const key = `products/${tenantId}/${skuCode}/${index}-${urlFingerprint}.${ext}`;

    const stored = await this.storage.upload(key, buffer, contentType);
    return stored.url;
  }
}

// 20s por foto: generoso para um CDN lento, curto o bastante para que um
// catálogo inteiro de origens mortas não vire uma sincronização eterna.
const TIMEOUT_MS = 20_000;

// 15 MB — o mesmo teto de corpo de requisição da API (ver main.ts). Foto de
// produto de marketplace fica ordens de grandeza abaixo disso; o limite existe
// contra resposta anômala, não contra uso legítimo.
const MAX_FOTO_BYTES = 15 * 1024 * 1024;

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'origem inválida';
  }
}

function extensionFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}
