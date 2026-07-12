# Arquitetura da Plataforma — Precifica

**Status:** documento norteador (north star), vivo — revisado a cada módulo novo.
**Objetivo:** registrar as decisões estruturais que garantem que a plataforma cresça para os 8 módulos da visão de produto sem exigir refatoração estrutural no caminho.

---

## 1. De repricer para plataforma

O sistema deixou de ser "uma calculadora de preço com repricing" para ser uma plataforma onde o Produto (SKU) é o ponto de agregação de oito áreas de inteligência especializadas. Isso muda o que a arquitetura precisa garantir: não é mais "construir um motor de preço bem feito", é **"construir N módulos que evoluem em velocidades diferentes, mantidos por (eventualmente) times diferentes, sem que um vaze premissas dentro do outro."** Esse é exatamente o problema que Domain-Driven Design (bounded contexts), Clean Architecture (inversão de dependência entre camadas) e SOLID (em especial Interface Segregation e Dependency Inversion) resolvem — não por serem "boas práticas" abstratas, mas porque cada um ataca um jeito específico desse sistema começar a apodrecer se ficarmos negligentes.

---

## 2. Mapa de bounded contexts

| Módulo (visão de produto) | Bounded context técnico | Responsabilidade | Status |
|---|---|---|---|
| Configurações | **Identity & Access** | Tenant, usuários, papéis, credenciais de integração | Construído (Etapa 1) |
| Produtos | **Catalog** | SKU, fornecedor, perfil fiscal, custo, atributos físicos | Construído (Etapa 2), evoluído na Etapa 5 (`erp-integration-architecture.md`) |
| Marketplace Intelligence | **Marketplace Intelligence** | Regras de comissão/taxa/política, versionadas, multi-fonte — inclui a taxa de gateway da Nuvemshop (`NuvemshopFeeRuleProvider`) | Construído (Etapa 4), estendido na Etapa 5.1 (providers por tenant) |
| — (novo, extraído da Etapa 2) | **Logistics Intelligence** | Peso cubado, peso de cobrança, custo logístico, simulação de frete | Construído (Etapa 3) |
| — (novo) | **ERP Integration** | Importação read-only de catálogo do Olist Tiny (fonte única da verdade) + conexão Nuvemshop + `ChannelListing` (vínculo SKU × canal) | Construído (Etapa 5 + 5.1, `erp-integration-architecture.md`) |
| Pricing Intelligence | **Pricing Intelligence** | Preço ideal, preço mínimo, margem, lucro — consome Catalog + Marketplace Intelligence + Logistics Intelligence + Competition Intelligence | Simulador de margem Nuvemshop (Etapa 5.1) + `PricingStrategist`/`PricingDecisionService` (ver `pricing-intelligence-architecture.md`) — decisão calculada e logada, aplicação automática ainda pendente de confirmação |
| Competition Intelligence | **Competition Intelligence** | Buy Box, líder/2º colocado, radares, estratégias de repricing | Primeira fatia construída (`competition-intelligence-architecture.md`) — contratos (`CompetitionRadar`), orquestrador, radar de exemplo (estrutura), eventos de domínio |
| Analytics | **Analytics** (read model) | Receita, margem, conversão, ROI, ROAS, giro — agregando eventos de todos os módulos | Não iniciado |
| AI Intelligence | **AI Intelligence** | Recomendações — consome read-ports/read-models de todos os módulos | Não iniciado |
| Dashboard | *(sem entidades próprias)* | Camada de composição — chama os read-ports dos módulos acima | Não iniciado |

Identity & Access é o único módulo verdadeiramente transversal (todo módulo depende dele para saber "de qual tenant é isso"); os demais só se comunicam entre si através de contratos explícitos, nunca acessando a tabela um do outro diretamente — essa é a regra que faz a diferença entre "monólito modular" de verdade e "monólito com pastas".

---

## 3. A regra de ouro: módulo nunca lê a tabela do outro

Fisicamente, tudo continua no mesmo Postgres (decisão mantida — ver seção 6). Mas na camada de código, um módulo só pode depender de outro através de uma **porta** (interface) exportada — nunca injetando o `PrismaService` para consultar uma tabela que pertence a outro bounded context. Concretamente:

```typescript
// Errado: PricingModule lendo a tabela de outro módulo diretamente.
class PricingService {
  constructor(private prisma: PrismaService) {}
  async calculate(productId: string) {
    const product = await this.prisma.product.findUnique(...); // acopla Pricing ao schema do Catalog
  }
}

// Certo: PricingModule depende de uma porta que o Catalog implementa e exporta.
interface ProductReader {
  getPricingInputs(productId: string, tenantId: string): Promise<ProductPricingInputs>;
}

class PricingService {
  constructor(@Inject(PRODUCT_READER) private products: ProductReader) {}
  async calculate(productId: string, tenantId: string) {
    const product = await this.products.getPricingInputs(productId, tenantId);
  }
}
```

Essa é a aplicação prática do **D de SOLID (Dependency Inversion)**: `PricingService` depende de uma abstração que ele mesmo declara precisar, não da implementação concreta do Catalog. É isso que torna a extração futura de um módulo em microserviço um problema de infraestrutura (trocar a implementação de `ProductReader` de "chamada direta" para "cliente HTTP/gRPC"), não de reescrever regra de negócio — exatamente o requisito que você colocou.

**Onde vivem essas portas:** um diretório `src/shared/contracts/` — o *shared kernel* do DDD. Nele ficam só interfaces e tipos (nunca implementação), coisas como `ProductReader`, `FeeRuleResolver` (já definido no doc de Marketplace Intelligence), `ShippingCostResolver`, `CompetitorSnapshotReader`, e os tipos de eventos de domínio. Todo módulo pode depender de `shared/contracts`; nenhum módulo depende de outro módulo diretamente.

---

## 4. Camadas dentro de cada módulo — e quando vale a pena

Para os módulos com regra de negócio de verdade (Pricing Intelligence, Marketplace Intelligence, Competition Intelligence, AI Intelligence), a estrutura interna segue Clean Architecture:

```
pricing-intelligence/
  domain/            # entidades e regras puras (ex.: fórmula de preço mínimo) — zero import de NestJS/Prisma
  application/        # casos de uso (CalculateIdealPrice, ApplyPriceToChannel) — orquestra domain + portas
  infrastructure/       # PricingRepository (Prisma), clients externos, jobs BullMQ
  interface/              # controllers REST, DTOs de entrada/saída
  pricing-intelligence.module.ts   # wiring do Nest — declara o que é exportado (a porta pública do módulo)
```

**Onde eu não aplicaria isso:** módulos de CRUD simples sem regra de negócio real — `suppliers` e `tax-profiles`, como já estão (service + controller + module direto), continuam assim. Camadas demais em cima de um cadastro de fornecedor é o oposto do problema que estamos resolvendo: complexidade que não paga aluguel. A régua que uso é "esse módulo tem lógica de domínio que precisa ser testada isoladamente de infraestrutura?" — se sim, camadas; se é só entrada/validação/persistência, service único resolve.

---

## 5. SOLID aplicado (não como princípio abstrato — como decisão já tomada)

- **Single Responsibility**: cada bounded context da seção 2 é uma responsabilidade. Dentro dele, controller cuida de HTTP, service/use-case cuida de orquestração, repository cuida de persistência.
- **Open-Closed**: já demonstrado no Marketplace Intelligence — novo marketplace = novo `Provider`, zero mudança no núcleo. O mesmo padrão se aplica a Competition Intelligence (novo tipo de fonte de concorrência) e a Logistics Intelligence (nova transportadora).
- **Liskov Substitution**: qualquer implementação de uma porta (`ProductReader`, `FeeRuleResolver`, um `MarketplaceProvider`) tem que ser substituível sem quebrar quem consome — é o que garante que trocar a implementação por uma versão HTTP (microserviço) não exige mudar o consumidor.
- **Interface Segregation**: portas pequenas e específicas (`ProductReader` só expõe o que Pricing precisa saber sobre um produto, não o `Product` inteiro do Catalog) em vez de uma interface gigante "tudo sobre produto". Evita que um módulo dependa de coisa que não usa — e evita que uma mudança em um campo não relacionado quebre um consumidor.
- **Dependency Inversion**: seção 3, o ponto central de tudo isso.

---

## 6. Estratégia de dados: um Postgres, schemas lógicos por módulo

Continuo recomendando **um único banco físico** — bancos separados por módulo hoje seria otimizar para uma escala que não existe ainda, e adicionaria overhead operacional real (transações distribuídas, consistência eventual) sem necessidade. Mas há uma mudança que vale adotar agora, porque o custo dela só cresce com o tempo: usar **schemas Postgres nomeados por bounded context** dentro do mesmo banco, via o recurso `multiSchema` do Prisma.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["identity", "catalog", "marketplace_intelligence", "logistics_intelligence", "pricing_intelligence", "competition_intelligence", "analytics"]
}

model Product {
  // ...
  @@schema("catalog")
}
```

**Por que agora é o momento certo:** ainda não rodamos nenhuma migration em produção — todo o schema atual (`Tenant`, `User`, `Product`, `Supplier`, `TaxProfile`) existe só como definição, nunca foi aplicado a um banco real. Adotar `multiSchema` depois da primeira migration real exigiria mover tabelas entre schemas com dados existentes; adotar agora é só reorganizar a definição antes do primeiro `migrate dev`. Isso também torna acidentes de acoplamento visíveis mais cedo — uma query que tenta juntar `catalog.products` com `pricing_intelligence.price_calculations` diretamente no SQL fica visualmente estranha e chama atenção em code review, reforçando a regra da seção 3 na prática, não só na documentação.

---

## 7. Comunicação entre módulos: chamada direta vs. evento

Dois padrões, dois motivos diferentes de uso:

- **Chamada síncrona via porta** (interface injetada) — para quando o módulo consumidor *precisa da resposta para continuar*. Exemplo: Pricing Intelligence precisa do resultado de `FeeRuleResolver.resolveFeeRule(...)` antes de conseguir calcular um preço; não tem como ser assíncrono aqui.
- **Evento de domínio** (via `@nestjs/event-emitter` agora; troca de transporte para fila/broker se algum módulo virar serviço separado) — para *efeitos colaterais* que não bloqueiam quem gerou o evento. Exemplo: quando o Pricing Intelligence recalcula e aplica um novo preço, ele emite `ProductPriceChanged`; quem escuta (Analytics, para atualizar o read-model de margem; AI Intelligence, para reavaliar recomendações; Alertas, se o novo preço encostou no mínimo) reage de forma independente, sem o Pricing Intelligence saber quem são os assinantes.

Regra prática: se a resposta é necessária para o fluxo atual continuar, é porta síncrona; se é "avisar que algo aconteceu", é evento.

---

## 8. O Produto como ponto de agregação — não como dono de tudo

Aqui refino um ponto do seu desenho: a tela do produto com abas (Geral, Precificação, Concorrência, Marketplaces, Estoque, Logística, Histórico, Analytics, IA) é **uma decisão de UI**, não deveria virar uma decisão de backend. Se eu construir um único endpoint agregador (`GET /products/:id/workspace`) que internamente chama Pricing + Competition + Logistics + Analytics + AI todos de uma vez, esse endpoint se torna, na prática, o módulo mais acoplado de todo o sistema — ele passa a depender de todos os outros oito, o que é exatamente o tipo de acoplamento central que a arquitetura modular existe para evitar. Também é ruim para performance: abrir um produto não deveria disparar oito consultas pesadas (histórico de vendas, radar de concorrência, recomendações de IA) se o usuário só quer ver a aba Geral.

**Proposta:** cada módulo expõe seu próprio endpoint, sempre parametrizado por `productId` — `GET /pricing-intelligence/products/:id`, `GET /competition-intelligence/products/:id`, `GET /logistics-intelligence/products/:id`, etc. O frontend é quem compõe a tela com abas, carregando cada aba sob demanda (lazy) conforme o usuário clica. O "produto no centro" continua verdadeiro — é o identificador comum que atravessa todos os módulos — só que a agregação acontece na borda (frontend/BFF), não no núcleo do domínio. Isso mantém cada módulo dono da sua aba, testável e substituível isoladamente, e é consistente com o que você mesmo descreveu: "cada módulo tenha sua responsabilidade".

---

## 9. Caminho de extração para microserviço

Quando (e não antes de) algum módulo justificar isolamento — cenário mais provável: Competition Intelligence, porque monitoramento de concorrente é I/O-intensivo e roda em paralelo constante, ou Marketplace Intelligence, se o número de sincronizações crescer muito — a extração segue três passos, nessa ordem, e nenhum deles toca regra de negócio:

1. A porta que os outros módulos usam para falar com ele (ex.: `FeeRuleResolver`) ganha uma segunda implementação, um cliente HTTP/gRPC, ao lado da implementação in-process atual.
2. O binding do NestJS (`{ provide: FEE_RULE_RESOLVER, useClass: ... }`) troca de `InProcessFeeRuleResolver` para `HttpFeeRuleResolver` — uma linha de configuração.
3. Os eventos de domínio que esse módulo emite/consome trocam de `EventEmitter2` (in-process) para um broker real (BullMQ já está na stack; RabbitMQ ou Kafka se o volume justificar).

O módulo em si — domínio, casos de uso, regras — não muda uma linha. É por isso que a disciplina da seção 3 (nunca acessar tabela alheia) importa mais do que a escolha entre monólito e microserviço em si: ela é o que preserva essa opcionalidade.

---

## 10. O que muda no que já foi construído

Duas decisões pendentes de confirmação antes de eu tocar em código:

**10.1 — Fronteira entre Catalog e Logistics Intelligence.** Hoje (Etapa 2), `Product` guarda peso, dimensões e os três campos calculados (`packedWeightKg`, `cubicWeightKg`, `shippingWeightKg`), e a fórmula vive em `src/products/product-weight.util.ts`. Com o módulo Logistics Intelligence formalizado, a fronteira correta é: **Catalog continua dono dos fatos físicos brutos** (peso, embalagem, dimensões — isso não muda com marketplace nem com transportadora), mas **o cálculo de peso cubado/peso de cobrança e, futuramente, custo logístico e simulação de frete passam a ser responsabilidade do Logistics Intelligence**, exposto como uma porta (`ShippingWeightCalculator`) que o Catalog chama ao salvar um produto — pelo mesmo motivo que `cubicWeightFactor` já é, na prática, uma regra configurável (hoje mora em `Tenant`, mas semanticamente pertence à Logistics Intelligence, não à conta em si).

**10.2 — Aplicar a nova estrutura em camadas retroativamente ou só a partir daqui?** Etapa 1 (Identity & Access) e Etapa 2 (Catalog) foram construídas antes desse desenho, no formato simples (service/controller/module). Não são módulos com regra de domínio complexa — pela régua da seção 4, provavelmente não precisam de camadas Clean Architecture completas. Preciso da sua decisão sobre isso e sobre a extração de Logistics Intelligence antes de seguir.
