import { CredentialEncryptionService } from './credential-encryption.service';

describe('CredentialEncryptionService', () => {
  const originalKey = process.env.ERP_CREDENTIALS_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ERP_CREDENTIALS_ENCRYPTION_KEY;
    } else {
      process.env.ERP_CREDENTIALS_ENCRYPTION_KEY = originalKey;
    }
  });

  // Regressão (20/10/2026): antes, faltar a env var só gerava um aviso e o
  // serviço seguia com uma chave de desenvolvimento fixa — nunca travava a
  // inicialização. Caso original reproduzido aqui antes da correção.
  it('onModuleInit lança erro (falha alta) quando ERP_CREDENTIALS_ENCRYPTION_KEY não está definida', () => {
    delete process.env.ERP_CREDENTIALS_ENCRYPTION_KEY;
    const service = new CredentialEncryptionService();

    expect(() => service.onModuleInit()).toThrow(/ERP_CREDENTIALS_ENCRYPTION_KEY/);
  });

  it('onModuleInit não lança quando a env var está definida, e encrypt/decrypt fazem ida e volta', () => {
    process.env.ERP_CREDENTIALS_ENCRYPTION_KEY = 'chave-de-teste-nao-usar-em-producao';
    const service = new CredentialEncryptionService();

    expect(() => service.onModuleInit()).not.toThrow();
    const cipherText = service.encrypt('segredo-de-teste');
    expect(service.decrypt(cipherText)).toBe('segredo-de-teste');
  });

  it('decrypt rejeita payload em formato inesperado (sem os 3 segmentos iv.authTag.cipherText)', () => {
    process.env.ERP_CREDENTIALS_ENCRYPTION_KEY = 'chave-de-teste-nao-usar-em-producao';
    const service = new CredentialEncryptionService();
    service.onModuleInit();

    expect(() => service.decrypt('payload-invalido-sem-pontos')).toThrow(/formato inesperado/);
  });
});
