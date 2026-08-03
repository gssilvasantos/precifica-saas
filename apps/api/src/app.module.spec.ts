import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaService } from './shared/prisma/prisma.service';

// Teste de FIAÇÃO, não de comportamento: compila o container inteiro do Nest.
//
// Por que existe (01/08/2026): quebrar a injeção de dependência é invisível
// para testes unitários — todos eles montam seus próprios providers com mocks.
// Um módulo que consome um token sem importar o módulo que o exporta passa em
// 1200 testes e falha no boot. Já aconteceu: marketplace-ads precisava do
// ErpIntegrationModule para CHANNEL_LISTING_READER e ninguém percebeu até
// subir a aplicação.
//
// Não toca no banco: PrismaService é substituído por um stub, porque o que
// está sob teste é o GRAFO de dependências, não a conexão.
describe('AppModule (fiação do container)', () => {
  it('compila com todos os módulos registrados', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn(), $on: jest.fn() })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
