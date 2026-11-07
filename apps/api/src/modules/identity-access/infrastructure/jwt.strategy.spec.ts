import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../application/users.service';

describe('JwtStrategy', () => {
  function buildConfig(jwtSecret: string | undefined): ConfigService {
    return { get: jest.fn().mockReturnValue(jwtSecret) } as unknown as ConfigService;
  }

  function buildUsers(overrides: Partial<jest.Mocked<UsersService>> = {}): jest.Mocked<UsersService> {
    return {
      findByIdWithTenantStatus: jest.fn(),
      ...overrides,
    } as unknown as jest.Mocked<UsersService>;
  }

  const SECRET = 'segredo-de-teste-com-32-bytes-ou-mais';
  const PAYLOAD = { sub: 'user-1', tenantId: 'tenant-1', role: 'ADMIN', moduleAccess: ['ORDERS'] } as never;

  // Regressão (20/10/2026): antes, JWT_SECRET ausente fazia a estratégia cair
  // em 'dev-secret-nao-usar-em-producao' (string fixa, comitada no
  // repositório) em vez de travar a inicialização — qualquer ambiente que
  // esquecesse de configurar a env var assinava/validava tokens com um
  // segredo conhecido publicamente.
  it('lança erro (falha alta) quando JWT_SECRET não está definida', () => {
    expect(() => new JwtStrategy(buildConfig(undefined), buildUsers())).toThrow(/JWT_SECRET/);
  });

  it('lança erro também quando JWT_SECRET é string vazia', () => {
    expect(() => new JwtStrategy(buildConfig(''), buildUsers())).toThrow(/JWT_SECRET/);
  });

  it('constrói normalmente quando JWT_SECRET está definida', () => {
    expect(() => new JwtStrategy(buildConfig(SECRET), buildUsers())).not.toThrow();
  });

  // Regressão (20/10/2026, mitigação de revogação — docs/decisions/0007-jwt-live-check.md):
  // antes, validate() só remapeava o payload do token, sem consultar o banco — banir um
  // usuário, trocar seu papel/módulos ou desativar o tenant só surtia efeito depois do
  // token expirar (até JWT_EXPIRES_IN, hoje "8h").
  it('validate consulta o banco e usa role/moduleAccess ATUAIS do usuário, não os do token', async () => {
    const users = buildUsers({
      findByIdWithTenantStatus: jest.fn().mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        role: 'VIEWER', // diferente do token, que diz ADMIN — banco deve vencer
        moduleAccess: ['CATALOG'],
        isActive: true,
        tenant: { isActive: true },
      }),
    });
    const strategy = new JwtStrategy(buildConfig(SECRET), users);

    const result = await strategy.validate(PAYLOAD);

    expect(users.findByIdWithTenantStatus).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'VIEWER',
      moduleAccess: ['CATALOG'],
    });
  });

  it('validate usa [] como padrão quando moduleAccess do usuário vem nulo', async () => {
    const users = buildUsers({
      findByIdWithTenantStatus: jest.fn().mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        role: 'VIEWER',
        moduleAccess: null,
        isActive: true,
        tenant: { isActive: true },
      }),
    });
    const strategy = new JwtStrategy(buildConfig(SECRET), users);

    const result = await strategy.validate(PAYLOAD);

    expect(result.moduleAccess).toEqual([]);
  });

  it('rejeita (401) quando o usuário não existe mais', async () => {
    const users = buildUsers({ findByIdWithTenantStatus: jest.fn().mockResolvedValue(null) });
    const strategy = new JwtStrategy(buildConfig(SECRET), users);

    await expect(strategy.validate(PAYLOAD)).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita (401) quando o usuário foi desativado (banido) desde a emissão do token', async () => {
    const users = buildUsers({
      findByIdWithTenantStatus: jest.fn().mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        role: 'ADMIN',
        moduleAccess: [],
        isActive: false,
        tenant: { isActive: true },
      }),
    });
    const strategy = new JwtStrategy(buildConfig(SECRET), users);

    await expect(strategy.validate(PAYLOAD)).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita (401) quando o tenant foi desativado desde a emissão do token', async () => {
    const users = buildUsers({
      findByIdWithTenantStatus: jest.fn().mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        role: 'ADMIN',
        moduleAccess: [],
        isActive: true,
        tenant: { isActive: false },
      }),
    });
    const strategy = new JwtStrategy(buildConfig(SECRET), users);

    await expect(strategy.validate(PAYLOAD)).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita (401) quando o usuário encontrado pertence a outro tenant (defesa extra, não deveria acontecer)', async () => {
    const users = buildUsers({
      findByIdWithTenantStatus: jest.fn().mockResolvedValue({
        id: 'user-1',
        tenantId: 'outro-tenant',
        role: 'ADMIN',
        moduleAccess: [],
        isActive: true,
        tenant: { isActive: true },
      }),
    });
    const strategy = new JwtStrategy(buildConfig(SECRET), users);

    await expect(strategy.validate(PAYLOAD)).rejects.toThrow(UnauthorizedException);
  });
});
