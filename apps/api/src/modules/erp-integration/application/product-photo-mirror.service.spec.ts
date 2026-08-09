import { ProductPhotoMirrorService } from './product-photo-mirror.service';

// Regressão de 09/08/2026. Este serviço baixa conteúdo de terceiro em laço,
// uma vez por foto de cada produto do catálogo, dentro do processo Node
// compartilhado por todos os tenants. Faltava tudo que protege isso:
// timeout, teto de tamanho, e um sinal de que a foto se perdeu.

const UM_PIXEL = new Uint8Array([1, 2, 3, 4]);

function respostaOk(bytes: Uint8Array = UM_PIXEL, contentType = 'image/jpeg') {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType, 'content-length': String(bytes.byteLength) }),
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as unknown as Response;
}

function construir() {
  const storage = {
    upload: jest.fn().mockImplementation(async (key: string) => ({ url: `https://cdn.exemplo/${key}` })),
  };
  const service = new ProductPhotoMirrorService(storage as never);
  return { service, storage };
}

describe('ProductPhotoMirrorService', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
    jest.restoreAllMocks();
  });

  it('aplica timeout na busca da foto', async () => {
    const { service } = construir();
    const fetchSpy = jest.fn().mockResolvedValue(respostaOk());
    global.fetch = fetchSpy as unknown as typeof fetch;

    await service.mirrorAll('tenant-1', 'SKU-1', ['https://origem.exemplo/foto.jpg']);

    // Sem signal, uma origem que aceita a conexão e nunca responde pendura o
    // sync inteiro — sem erro e sem fim.
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('recusa foto acima do teto de tamanho, pelo cabeçalho', async () => {
    const { service, storage } = construir();
    const gigante = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(20 * 1024 * 1024) }),
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Response;
    global.fetch = jest.fn().mockResolvedValue(gigante) as unknown as typeof fetch;

    const resultado = await service.mirrorAll('tenant-1', 'SKU-1', ['https://origem.exemplo/enorme.jpg']);

    expect(resultado.urls).toEqual([]);
    expect(resultado.houveFalha).toBe(true);
    // Não chega a carregar 20 MB em memória nem a subir para o storage.
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('recusa foto acima do teto quando o cabeçalho mente', async () => {
    const { service, storage } = construir();
    const mentiroso = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': '10' }),
      arrayBuffer: async () => new ArrayBuffer(20 * 1024 * 1024),
    } as unknown as Response;
    global.fetch = jest.fn().mockResolvedValue(mentiroso) as unknown as typeof fetch;

    const resultado = await service.mirrorAll('tenant-1', 'SKU-1', ['https://origem.exemplo/mentiroso.jpg']);

    expect(resultado.houveFalha).toBe(true);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('sinaliza houveFalha quando uma foto falha, sem derrubar as demais', async () => {
    const { service } = construir();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(respostaOk())
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(respostaOk()) as unknown as typeof fetch;

    const resultado = await service.mirrorAll('tenant-1', 'SKU-1', [
      'https://origem.exemplo/1.jpg',
      'https://origem.exemplo/2.jpg',
      'https://origem.exemplo/3.jpg',
    ]);

    // As duas que deram certo entram; a falha vira SINAL, não silêncio. Sem
    // isso o orquestrador gravava o contentHash como se tudo tivesse ido bem
    // e a foto ficava perdida até alguém editar o cadastro no Olist.
    expect(resultado.urls).toHaveLength(2);
    expect(resultado.houveFalha).toBe(true);
  });

  it('não vaza a URL de origem no log de falha', async () => {
    const { service } = construir();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
    // O logger é campo de INSTÂNCIA (`private readonly logger = new Logger()`),
    // não do prototype — o spy tem que ser no objeto criado.
    const logger = (service as unknown as { logger: { warn: (mensagem: string) => void } }).logger;
    const warn = jest.spyOn(logger, 'warn').mockImplementation();

    await service.mirrorAll('tenant-1', 'SKU-1', ['https://origem.exemplo/foto.jpg?token=SEGREDO']);

    // Anexo servido por URL pré-assinada carrega credencial na query string.
    const mensagem = String(warn.mock.calls[0]?.[0] ?? '');
    expect(mensagem).not.toContain('SEGREDO');
    expect(mensagem).toContain('origem.exemplo');
  });

  it('sem falha nenhuma, houveFalha é false', async () => {
    const { service } = construir();
    global.fetch = jest.fn().mockResolvedValue(respostaOk()) as unknown as typeof fetch;

    const resultado = await service.mirrorAll('tenant-1', 'SKU-1', ['https://origem.exemplo/1.jpg']);

    expect(resultado.houveFalha).toBe(false);
    expect(resultado.urls).toHaveLength(1);
  });
});
