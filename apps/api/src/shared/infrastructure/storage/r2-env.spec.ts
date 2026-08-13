import { requireStorageEnv } from './r2-env';

// Regressão de um incidente real (13/08/2026). R2_BUCKET estava preenchido com
// a URL do endpoint em vez do nome do bucket. A verificação de presença passava
// (o valor não era vazio) e o erro só aparecia lá no fundo do SDK da AWS —
// "Bucket name shouldn't contain '/'" — uma vez por FOTO, em todo sync.
//
// Nenhuma foto do catálogo foi espelhada enquanto isso durou, e o log parecia
// falha de rede.

describe('requireStorageEnv', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('devolve o valor quando presente e bem formado', () => {
    process.env.R2_BUCKET = 'kyneti-assets';
    expect(requireStorageEnv('R2_BUCKET')).toBe('kyneti-assets');
  });

  it('remove espaço em volta — copiar do painel costuma trazer', () => {
    process.env.R2_BUCKET = '  kyneti-assets  ';
    expect(requireStorageEnv('R2_BUCKET')).toBe('kyneti-assets');
  });

  it('variável ausente falha citando o nome dela', () => {
    delete process.env.R2_BUCKET;
    expect(() => requireStorageEnv('R2_BUCKET')).toThrow(/R2_BUCKET.*ausente/);
  });

  describe('forma errada — presente, mas inutilizável', () => {
    it('R2_BUCKET com a URL do endpoint (o erro que aconteceu em produção)', () => {
      process.env.R2_BUCKET = 'https://45ab8972f03ccd279a60b338dcf5aca7.r2.cloudflarestorage.com';

      expect(() => requireStorageEnv('R2_BUCKET')).toThrow(/forma errada/);
      // A mensagem tem que dizer o que era esperado, não só que está errado.
      expect(() => requireStorageEnv('R2_BUCKET')).toThrow(/NOME do bucket/);
    });

    it('R2_BUCKET com barra em qualquer posição', () => {
      process.env.R2_BUCKET = 'kyneti-assets/produtos';
      expect(() => requireStorageEnv('R2_BUCKET')).toThrow(/forma errada/);
    });

    it('R2_PUBLIC_BASE_URL apontando para o endpoint autenticado', () => {
      // Confusão fácil e cara: a foto seria gravada com uma URL que devolve
      // 401 no navegador do lojista.
      process.env.R2_PUBLIC_BASE_URL = 'https://45ab8972.r2.cloudflarestorage.com';
      expect(() => requireStorageEnv('R2_PUBLIC_BASE_URL')).toThrow(/nunca o R2_ENDPOINT/);
    });

    it('R2_ENDPOINT que não é a API S3 do R2', () => {
      process.env.R2_ENDPOINT = 'https://pub-abc123.r2.dev';
      expect(() => requireStorageEnv('R2_ENDPOINT')).toThrow(/forma errada/);
    });

    it('não ecoa o valor no erro — R2_ENDPOINT carrega o account id', () => {
      const accountId = '45ab8972f03ccd279a60b338dcf5aca7';
      process.env.R2_BUCKET = `https://${accountId}.r2.cloudflarestorage.com`;

      expect(() => requireStorageEnv('R2_BUCKET')).not.toThrow(new RegExp(accountId));
    });
  });

  describe('valores legítimos que NÃO podem ser recusados', () => {
    it.each([
      ['R2_ENDPOINT', 'https://45ab8972f03ccd279a60b338dcf5aca7.r2.cloudflarestorage.com'],
      ['R2_PUBLIC_BASE_URL', 'https://pub-abc123.r2.dev'],
      ['R2_PUBLIC_BASE_URL', 'https://assets.kyneti.com.br'],
      ['R2_BUCKET', 'kyneti-assets'],
    ])('%s aceita %s', (nome, valor) => {
      process.env[nome] = valor;
      expect(() => requireStorageEnv(nome)).not.toThrow();
    });

    it('variável sem regra de forma continua só exigindo presença', () => {
      process.env.R2_ACCESS_KEY = 'qualquer-coisa-opaca';
      expect(requireStorageEnv('R2_ACCESS_KEY')).toBe('qualquer-coisa-opaca');
    });
  });
});
