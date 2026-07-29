# Benchmark Bling ERP (API v3) — parecer técnico

Análise do `API Bling.json` (OpenAPI 3.0, 162 rotas, 407 schemas, 45 tags) contra o estado real do Kyneti nesta data. Mesma metodologia do benchmark Tiny ERP (`docs/tiny-erp-benchmark-analysis.md`): absorver o que agrega valor, aperfeiçoar o que já existe mas está raso, descartar o que é peso morto de ERP tradicional. Todos os nomes de entidade/rota citados abaixo são exatamente os do Swagger do Bling.

## 1. O que ABSORVER (recursos que o Kyneti não tem)

### 1.1 Ordens de Produção + Produtos-Estruturas (BOM real) — prioridade alta

Hoje o Kyneti só tem `Product.isKit` (um booleano de Sprint 26, puramente para herdar embalagem/margem). O Bling modela composição de produto como duas peças reais:

- **`ProdutosEstruturaDTO`** (`GET/PUT /produtos/estruturas/{idProdutoEstrutura}`, `POST/DELETE .../componentes`): `componentes: ProdutosComponenteDTO[]` (produto+quantidade) mais dois campos que decidem o COMPORTAMENTO de estoque: `tipoEstoque` (`F` Físico / `V` Virtual — o kit em si tem saldo próprio ou é sempre calculado a partir dos componentes) e `lancamentoEstoque` (`A` Produto e Componente / `M` só Componente / `P` só Produto — que baixa de estoque a venda do kit realmente dispara).
- **`Ordens de Produção`** (`/ordens-producao`): ordem real de fabricação/montagem — `itens` (produto+quantidade a produzir), `OrdensProducaoDepositoDTO` com `idOrigem`/`idDestino` (deposito de onde os componentes saem e onde o produto pronto entra), `situacao` (workflow próprio), e o endpoint `POST /ordens-producao/gerar-sob-demanda` (gera a ordem automaticamente quando falta saldo do produto acabado para atender uma venda).

Por que importa: qualquer seller que monta kit/combo (muito comum em multicanal — "kit 3 unidades", "combo presente") ou que faz manufatura leve/private label precisa de uma baixa de estoque auditável dos componentes, não só um flag decorativo. Sem isso o saldo do Kyneti fica errado assim que um kit vende. É o gap mais crítico dos três "Absorver".

### 1.2 Produtos-Lotes (rastreamento de lote/validade, FEFO) — prioridade alta para quem vende perecível/cosmético/farma

`Produtos - Lotes` + `Produtos - Lotes Lançamentos`: `LotesDTO` (`codigoLote`, `dataFabricacao`, `dataValidade`, `diasPermitidoVenda` — dias antes do vencimento em que o produto para de poder ser vendido, `codigoAgregacao` — código de pallet/agregação, `status` Ativo/Inativo), `LoteLancamentoDTO` (`tipoLancamento` Entrada/Saída/Balanço por LOTE, não só por produto), `SaldoLoteDTO`/`SaldoSomaLotesDTO` (saldo por lote, por depósito, e total). Tem até endpoint dedicado `GET /produtos/lotes/controla-lote` para saber em lote quais produtos têm controle de lote ativo.

O Kyneti não tem NENHUM controle de lote/validade hoje. Para quem revende cosmético, suplemento, alimento ou farmacêutico isso não é opcional — é o que evita vender produto vencido e é exigido por vigilância sanitária em alguns segmentos.

### 1.3 Vendedores + Comissão — prioridade média-alta

`Vendedores` (`VendedoresDadosDTO.comissoes: VendedoresComissaoDTO[]` com `aliquota`+`descontoMaximo`) e o item de venda carrega o cálculo pronto (`VendasItemComissaoDTO`: `base`, `aliquota`, `valor`). O Kyneti não tem conceito de vendedor/comissão em lugar nenhum do schema. Times que vendem por atendimento consultivo (WhatsApp, loja própria Nuvemshop com vendedor interno) não conseguem hoje calcular quanto cada vendedor tem a receber — é rateio manual em planilha. Endpoint de referência: `GET /vendedores`, `GET /vendedores/{idVendedor}`.

### 1.4 `intermediador` na NF-e — prioridade CRÍTICA (compliance, não feature)

`NotasFiscaisDadosPostDTO.intermediador: { cnpj, nomeUsuario }` (mesmo campo em `VendasIntermediadorDTO`). Isso é o Grupo G da NF-e exigido pela Nota Técnica 2020.006 da SEFAZ para toda venda intermediada por marketplace — o Kyneti hoje (`apps/api/src/modules/fiscal/domain/nfe-payload-builder.ts`) **não envia esse campo em nenhuma hipótese**. Toda NF-e emitida hoje para uma venda do Mercado Livre/Shopee/Nuvemshop está tecnicamente incompleta perante a SEFAZ (o campo é opcional na prática de muitos emissores até serem fiscalizados, mas é o tipo de gap que vira autuação, não só "boa prática"). Isso deveria furar a fila de qualquer outro item deste documento.

### 1.5 Geração automática de combinações de variação — quick win de UX

`POST /produtos/variacoes/atributos/gerar-combinacoes`: dado `ProdutosVariacoesAtributoDTO[]` (nome do atributo + lista de opções, ex.: Cor:[Azul,Verde], Tamanho:[P,M,G]), devolve o produto pai já com a grade completa de variações combinadas. O Kyneti (Fase 2, Produto Pai/Variação) exige cadastrar cada variação manualmente. Isso é puro ganho de velocidade de cadastro, sem risco.

### 1.6 Logísticas — Remessas (postagem em lote de verdade)

`Logísticas - Remessas` (`POST /logisticas/remessas`, `GET /logisticas/{idLogistica}/remessas`) agrupa múltiplos `LogisticasObjetos` (objetos de postagem individuais, cada um com `dimensao`, `embalagem`, `rastreamento`, `valorDeclarado`, `avisoRecebimento`, `maoPropria`) numa remessa única entregue ao transportador de uma vez. Isso é conceitualmente muito perto do que o Kyneti acabou de construir na Fase 5 (`DispatchBatch`), mas o Bling tem dois campos que o Kyneti não tem ainda: `avisoRecebimento` (aviso de recebimento — exigido por alguns clientes/contratos) e `maoPropria` (entrega mão própria — obrigatório para documentos/produtos de valor). Ver seção 2.3 para o comparativo completo — aqui entra como "absorver campos", não como módulo novo.

## 2. O que APERFEIÇOAR (o Kyneti já tem, mas raso)

| Área Kyneti hoje | O que o Bling faz melhor | Entidade/rota de referência |
|---|---|---|
| `nfe-payload-builder.ts` só emite `finalidade_emissao: 1` (Normal), hardcoded | `NotasFiscaisDadosPostDTO.finalidade` (1 Normal / 2 Complementar / 3 Ajuste / 4 Devolução / 5 Crédito / 6 Débito) + `documentoReferenciado`/`documentosReferenciados` para linkar a nota de origem | `NotasFiscaisDadosPostDTO`, `NotasFiscaisDocumentoReferenciadoDTO` |
| `tax-code-resolver.ts` só resolve CFOP 5102/6102 (revenda simples, Simples Nacional) — o próprio comentário do código já assume isso como gap | `Naturezas de Operações` com regras por operação (`padrao`: venda física/jurídica/consumidor final/compra/devolução etc.) e endpoint dedicado `POST /naturezas-operacoes/{id}/obter-tributacao` que devolve a tributação já calculada para aquela natureza | `NaturezasOperacoesDadosDTO` |
| `Product` tem `ncm`/`gtin`/`fiscalOriginCode` (Fase 0) mas **não tem CEST** | `ProdutosTributacaoDTO.cest` — obrigatório para qualquer produto sujeito a Substituição Tributária (eletrônicos, cosméticos, autopeças, bebidas) | `ProdutosTributacaoDTO` |
| `AccountsPayable.markPaid(tenantId, id, paidAt)` só marca pago/não pago, valor fixo desde a criação | `ContasBaixarContaDTO`: baixa com `juros`, `desconto`, `acrescimo`, `valorRecebido` (pode diferir do valor original) e `tarifa` (taxa da forma de pagamento) — baixa parcial/com ajuste é o normal na vida real, não exceção | `ContasBaixarContaDTO` |
| `ReceivableRecord` é binário (`PENDING`/paga), sem parcelamento nativo | `ContasReceberOcorrenciaDTO`/`ContasReceberOcorrenciaParceladaDTO` — ocorrência única, parcelada (com `numeroParcelas`) ou recorrente (mensal/bimestral/trimestral/semestral/anual/quinzenal) nativamente no cadastro da conta | `ContasReceberOcorrenciaDTO` |
| `Warehouse`/estoque: saldo único por depósito | `EstoquesDadosBaseDTO.operacao` (`B` Balanço / `E` Entrada / `S` Saída) como ajuste manual de estoque com motivo, e `EstoquesDepositoDTO.saldoFisico` vs `saldoVirtual` (saldo desconsiderando reservado) — o Kyneti não distingue saldo físico de saldo "livre para vender" | `EstoquesDadosBaseDTO`, `EstoquesDepositoDTO` |
| `formaEnvio` do `DispatchBatch` (Fase 5) é um único texto livre, sem catálogo de transportador/serviço nem apelido | `Logísticas`/`Logísticas - Serviços`: `LogisticasServicoDTO` tem `descricao`, `codigo`, `aliases` (nomes alternativos que o mesmo serviço recebe em integrações diferentes), `estimativaEntrega`, `ativo` — um cadastro real de transportador+serviço, não uma string solta | `LogisticasDadosDTO`, `LogisticasServicoDTO` |
| Etiqueta de expedição (Fase 5) não carrega `valorDeclarado`, `avisoRecebimento`, `maoPropria`, `prazoEntregaPrevisto` | `LogisticasObjetosDadosDTO` traz os quatro campos como parte padrão de todo objeto de postagem | `LogisticasObjetosDadosDTO` |
| Rastreamento de envio (`trackingCode`) é só uma string | `LogisticasObjetosRastreamentoDTO`: `situacao` (enum 0-9: Postado/Em andamento/Não entregue/Entregue/Aguardando retirada/...), `origem`/`destino` (cidade+UF), `ultimaAlteracao`, `url` — um modelo de rastreio padronizado entre transportadoras, não um status por canal | `LogisticasObjetosRastreamentoDTO` |
| `Product.isKit` é decorativo (herda embalagem/margem) | Ver seção 1.1 — `tipoEstoque`/`lancamentoEstoque` decidem baixa de estoque de verdade | `ProdutosEstruturaDTO` |
| Tagging genérico (`TagAssignment`) só marca entidade com tag livre | `Campos Customizados`: campo tipado por módulo (`CamposCustomizadosTipoDTO.mascara`, opções via `CamposCustomizadosOpcaoDTO`) com permissão por papel (`CamposCustomizadosPermissaoDTO.autorizado`) — mais estruturado que tag livre quando o dado precisa ser validado (data, número, lista fechada) | `CamposCustomizadosDadosDTO` |
| `PurchaseOrderItem.ipi` é o único imposto capturado na Ordem de Compra | `PedidosComprasTributacaoDTO`/`PedidosComprasItemNotaFiscalDTO` — vínculo do item da ordem de compra com a NF-e de entrada do fornecedor, para conferência automática | `PedidosComprasItemNotaFiscalDTO` |

### 2.3 Fluxo operacional: da venda ao envio

O Bling mantém o mesmo princípio de "ação explícita, nunca automática" que o Kyneti já adota (Safety Lock) — reforça que a arquitetura atual está no caminho certo, não precisa mudar de filosofia: `POST /pedidos/vendas/{id}/lancar-estoque`, `.../estornar-estoque`, `.../lancar-contas`, `.../estornar-contas`, `.../gerar-nfe`, `.../gerar-nfce` são todos endpoints SEPARADOS e reversíveis, exatamente como `DispatchBatchService.generateLabel`/`concludeBatch` do Kyneti. O que falta é fechar o mesmo padrão na ponta de NF-e: `POST /nfe/{id}/lancar-estoque/{idDeposito}` permite escolher o depósito no MOMENTO do lançamento — o `FiscalInvoiceService` do Kyneti hoje não tem essa escolha explícita (assume o fluxo de auto-emissão via listener). Vale revisar se emissão manual de NF-e (fora do listener automático) precisa dessa opção.

## 3. O que DESCARTAR (peso morto de ERP tradicional)

- **`Situações`/`Situações - Módulos`/`Situações - Transições`/`Situações - Ações`** — motor de máquina de estados 100% configurável pelo usuário, por módulo, com CRUD de estado/transição/ação (`SituacoesDTO`, `SituacoesTransicaoDTO`, `SituacoesAcaoDTO`). É flexibilidade de ERP legado clássico: qualquer tenant pode inventar seu próprio fluxo de status para Pedido/Compra/Contato, o que na prática gera 200 variações de "quase a mesma coisa" entre clientes diferentes e um sistema de configuração que ninguém entende sem suporte. O Kyneti usa enums de domínio + gates puros (`resolveLabelStrategy`, `canConcludeBatch` etc.) — muito mais previsível, testável, e resolveu os casos reais do benchmark (ex.: `APROVADO`/`NAO_ENTREGUE`) sem precisar de um motor genérico. Não replicar.
- **`Contratos`** (cobrança recorrente/assinatura com `ContratosCobrancaVencimentoDTO`, `ContratosVendedorComissaoDTO`) — serve negócio de assinatura/serviço recorrente B2B. Fora do perfil do Kyneti (revenda multicanal de produto físico). Não há pedido de nenhum usuário para isso; não construir enquanto não houver.
- **`Notas Fiscais de Serviço Eletrônicas` (NFS-e)** — decisão já tomada na Fase 0 do benchmark Tiny ERP (Focus NFe em vez de eNotas, exatamente por causa disso: Kyneti vende produto, não serviço). O Bling ter isso não muda a decisão.
- **`Homologação`** (`/homologacao/produtos`) — plumbing de ambiente de testes da SEFAZ que o parceiro fiscal escolhido (Focus NFe) já resolve por trás da própria API; não precisa virar entidade exposta no Kyneti.
- **`Categorias - Lojas` + `Categorias - Produtos` + `Grupos de Produtos` + `Linha de Produto`** coexistindo — o próprio Bling tem 3-4 taxonomias de produto se sobrepondo (categoria, grupo, linha, categoria da loja). É o tipo de redundância histórica de ERP que confunde o usuário final ("em qual desses 4 lugares eu categorizo?"). O Kyneti já decidiu certo na Fase 4 (`ProductCategory` como árvore única + `ChannelCategoryMapping` para o de-para por canal) — não adicionar uma segunda taxonomia paralela.
- **`Propostas Comerciais`/`Orçamentos`** — fluxo de cotação B2B (proposta → aprovação → venda). Relevante para venda consultiva direta, não para o perfil majoritariamente marketplace do Kyneti. Backlog, não prioridade.
- **`Borderôs`** (agrupamento de baixas de contas para conciliação bancária em lote) — só faz sentido em volume de contas a receber MUITO maior do que o Kyneti opera hoje (reconciliação de repasse de marketplace já é automática via `ReceivableReconciliationService`). Não construir agora.
- **Campos de `ProdutosTributacaoDTO` de nicho: `tipoArmamento`, `descricaoCompletaArmamento`, `codigoANP`/`descricaoANP` (combustível), `percentualGLP`/`percentualGasNacional`/`percentualGasImportado`** — tributação de armamento e combustível não têm nenhuma aderência ao perfil de seller do Kyneti. Ignorar completamente.
- **`Documentos Compartilhados`** (link público por token) e **`Notificações`** — features de conveniência de baixo impacto, sem diferenciação competitiva. Não priorizar.
- **Multi-filial (`CanalVendaFilialDTO.cnpj`/`idUnidadeNegocio`)** — suporte a múltiplos CNPJs dentro da mesma conta. Real, mas é decisão de modelagem de tenant muito maior (hoje 1 tenant Kyneti = 1 CNPJ) — não é "descartar" no sentido de ruim, é fora de escopo do MVP atual; só entra se aparecer demanda de um seller com múltiplas empresas.

## 4. Roadmap sugerido (Impacto x Esforço)

### Quick Wins (baixo esforço, valor imediato)

| Item | Onde entra | Esforço |
|---|---|---|
| **`intermediador` (CNPJ+nomeUsuario) no payload da NF-e** | `nfe-payload-builder.ts` + `FiscalInvoiceService` (buscar CNPJ do canal a partir de `channelCode`) | Muito baixo — 1 campo novo + mapa canal→CNPJ dos 3-4 marketplaces já integrados |
| **`CEST` no `Product`** | Campo novo em `catalog.Product`, mesmo padrão de `ncm`/`gtin` | Muito baixo |
| **`saldoFisico` vs `saldoVirtual`** por depósito | `Warehouse`/estoque — expor saldo reservado (pedidos em picking) separado do saldo livre | Baixo — dado já existe implicitamente via `DispatchBatchOrder`/`StockMovementAuditEvent`, falta só agregação |
| **Baixa de conta com `juros`/`desconto`/`tarifa`** | `AccountsPayableService.markPaid`/`ReceivableRecord` — aceitar valor de baixa diferente do valor original | Baixo |
| **Geração automática de combinações de variação** | Endpoint novo em `catalog` (Produto Pai/Variação, Fase 2) | Baixo |
| **`avisoRecebimento`/`maoPropria`/`valorDeclarado` na etiqueta** | `DispatchBatchOrder`/`GenerateLabelManualInput` (Fase 5) | Baixo — só novos campos opcionais no DTO de geração de etiqueta |
| **CFOP de devolução/complementar (`finalidade`)** | `tax-code-resolver.ts` + `FiscalInvoiceService` | Médio-baixo |

### Projetos Estruturantes (mais engenharia, mudam de patamar)

| Item | Por que estruturante |
|---|---|
| **Produtos-Estruturas (BOM real) + Ordens de Produção** | Schema novo (componentes, tipo de baixa de estoque), módulo novo de produção, integração com `StockLedgerEntry` existente — muda como o Kyneti calcula saldo de kit pela primeira vez de verdade |
| **Produtos-Lotes (FEFO/validade)** | Schema novo (lote, saldo por lote, lançamento por lote), regra de bloqueio de venda por `diasPermitidoVenda`, tela de gestão de lote — módulo inteiro novo, condicional ao segmento de clientes que o Kyneti for priorizar |
| **Vendedores + Comissão** | Modelo novo (`Vendedor`, `Commission`), cálculo por item de venda, relatório de comissão a pagar — cruza com Financeiro (Contas a Pagar) para o repasse |
| **Naturezas de Operação (CFOP configurável por cenário)** | Generaliza `resolveCfop` hoje hardcoded para um motor de regras (interestadual, ST, devolução, consumidor final vs. contribuinte) — pré-requisito de médio prazo para atender clientes fora do caso simples de revenda Simples Nacional |
| **Catálogo de Transportador/Serviço (`Logísticas`/`Logísticas-Serviços`)** | Substitui o `formaEnvio` texto-livre do `DispatchBatch` por um cadastro real de transportador+serviço com `aliases`/`estimativaEntrega`/`ativo` — melhora a Fase 5 recém-fechada sem mudar sua arquitetura de gates |

### Fora do roadmap por ora

Situações/Transições (motor de FSM genérico), Contratos, NFS-e, Homologação, Propostas Comerciais/Orçamentos, Borderôs, multi-filial — todos descritos na seção 3, sem indicação de demanda real do usuário hoje.
