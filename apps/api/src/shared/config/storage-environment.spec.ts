import { resolveStorageDriver } from './storage-environment';

describe('resolveStorageDriver', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.STORAGE_DRIVER;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('STORAGE_DRIVER=r2 explícito vence, mesmo em dev', () => {
    process.env.STORAGE_DRIVER = 'r2';
    process.env.NODE_ENV = 'development';
    expect(resolveStorageDriver()).toBe('r2');
  });

  it('STORAGE_DRIVER=local explícito vence, mesmo em produção', () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.NODE_ENV = 'production';
    expect(resolveStorageDriver()).toBe('local');
  });

  it('sem STORAGE_DRIVER: cai para NODE_ENV=production => r2', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveStorageDriver()).toBe('r2');
  });

  it('sem STORAGE_DRIVER nem NODE_ENV=production: local', () => {
    process.env.NODE_ENV = 'development';
    expect(resolveStorageDriver()).toBe('local');
  });

  it('valor inválido de STORAGE_DRIVER é ignorado, cai para o fallback de NODE_ENV', () => {
    process.env.STORAGE_DRIVER = 'algumacoisa';
    process.env.NODE_ENV = 'production';
    expect(resolveStorageDriver()).toBe('r2');
  });
});
