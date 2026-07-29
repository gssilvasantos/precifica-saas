import { buildNfePayload, hasRequiredItemFields, NfePayloadInput } from './nfe-payload-builder';

function buildInput(overrides: Partial<NfePayloadInput> = {}): NfePayloadInput {
  return {
    naturezaOperacao: 'Venda de mercadoria',
    dataEmissao: new Date('2026-07-28T12:00:00'),
    emitente: {
      cnpj: '07.504.505/0001-32',
      razaoSocial: 'Kyneti Comércio Ltda',
      nomeFantasia: 'Kyneti',
      inscricaoEstadual: '123456789',
      regimeTributario: 1,
      logradouro: 'Rua das Flores',
      numero: '100',
      bairro: 'Centro',
      municipio: 'São Paulo',
      uf: 'SP',
      cep: '01000-000',
    },
    destinatario: {
      nome: 'Cliente Final',
      documento: '030.550.549-11',
      endereco: {
        logradouro: 'Rua São Januário',
        numero: '99',
        bairro: 'Crespo',
        municipio: 'Manaus',
        uf: 'AM',
        cep: '69073-178',
      },
      telefone: '(11) 96185-5555',
    },
    items: [
      {
        numeroItem: 1,
        codigoProduto: 'SKU-001',
        descricao: 'Camiseta Azul P',
        ncm: '61091000',
        icmsOrigem: 0,
        quantidade: 2,
        valorUnitario: 50,
        valorBruto: 100,
      },
    ],
    ...overrides,
  };
}

describe('hasRequiredItemFields', () => {
  it('rejeita lista vazia', () => {
    expect(hasRequiredItemFields([])).toBe(false);
  });

  it('rejeita item sem NCM', () => {
    expect(hasRequiredItemFields([{ ncm: '' }])).toBe(false);
  });

  it('aceita quando todo item tem NCM', () => {
    expect(hasRequiredItemFields([{ ncm: '61091000' }])).toBe(true);
  });
});

describe('buildNfePayload', () => {
  it('monta os campos gerais e do emitente', () => {
    const payload = buildNfePayload(buildInput());

    expect(payload.natureza_operacao).toBe('Venda de mercadoria');
    expect(payload.tipo_documento).toBe(1);
    expect(payload.finalidade_emissao).toBe(1);
    expect(payload.cnpj_emitente).toBe('07504505000132');
    expect(payload.uf_emitente).toBe('SP');
    expect(payload.regime_tributario_emitente).toBe(1);
  });

  it('usa CPF do destinatário quando o documento tem 11 dígitos', () => {
    const payload = buildNfePayload(buildInput());
    expect(payload.cpf_destinatario).toBe('03055054911');
    expect(payload.cnpj_destinatario).toBeUndefined();
  });

  it('usa CNPJ do destinatário quando o documento tem 14 dígitos', () => {
    const payload = buildNfePayload(buildInput({ destinatario: { ...buildInput().destinatario, documento: '11.222.333/0001-81' } }));
    expect(payload.cnpj_destinatario).toBe('11222333000181');
    expect(payload.cpf_destinatario).toBeUndefined();
  });

  it('resolve CFOP interestadual quando UF do destinatário difere da do emitente', () => {
    const payload = buildNfePayload(buildInput()) as { items: { cfop: string }[] };
    expect(payload.items[0].cfop).toBe('6102');
  });

  it('resolve CFOP interno quando UF do destinatário é igual à do emitente', () => {
    const input = buildInput({ destinatario: { ...buildInput().destinatario, endereco: { ...buildInput().destinatario.endereco, uf: 'SP' } } });
    const payload = buildNfePayload(input) as { items: { cfop: string }[] };
    expect(payload.items[0].cfop).toBe('5102');
  });

  // Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
  // 29/07/2026) — cfopConfig presente sobrepõe o CFOP hardcoded de
  // resolveCfop.
  it('cfopConfig presente: usa o CFOP customizado da natureza em vez do hardcoded', () => {
    const input = buildInput({
      cfopConfig: { cfopVendaInterno: '5405', cfopVendaInterestadual: '6404' },
    });
    const payload = buildNfePayload(input) as { items: { cfop: string }[] };
    expect(payload.items[0].cfop).toBe('6404');
  });

  it('cfopConfig ausente: mantém o comportamento hardcoded (resolveCfop)', () => {
    const payload = buildNfePayload(buildInput()) as { items: { cfop: string }[] };
    expect(payload.items[0].cfop).toBe('6102');
  });

  it('aplica os defaults de Simples Nacional em cada item', () => {
    const payload = buildNfePayload(buildInput()) as { items: Record<string, unknown>[] };
    expect(payload.items[0].icms_situacao_tributaria).toBe('102');
    expect(payload.items[0].pis_situacao_tributaria).toBe('07');
    expect(payload.items[0].cofins_situacao_tributaria).toBe('07');
  });

  it('usa ICMS_ORIGEM_FALLBACK (0) quando o item não informa origem', () => {
    const input = buildInput({ items: [{ ...buildInput().items[0], icmsOrigem: null }] });
    const payload = buildNfePayload(input) as { items: Record<string, unknown>[] };
    expect(payload.items[0].icms_origem).toBe(0);
  });

  it('soma valor_produtos a partir dos itens e calcula valor_total com frete/desconto', () => {
    const payload = buildNfePayload(buildInput({ valorFrete: 10, valorDesconto: 5 }));
    expect(payload.valor_produtos).toBe(100);
    expect(payload.valor_total).toBe(105);
  });

  describe('Grupo G — intermediador (NT 2020.006, benchmark Bling)', () => {
    it('sem intermediador informado: indicador_intermediario vai 0, sem os demais campos', () => {
      const payload = buildNfePayload(buildInput());
      expect(payload.indicador_intermediario).toBe(0);
      expect(payload.cnpj_intermediario).toBeUndefined();
      expect(payload.id_intermediario).toBeUndefined();
    });

    it('com intermediador informado: indicador vai 1 e envia CNPJ (só dígitos) + idCadIntTran', () => {
      const payload = buildNfePayload(
        buildInput({ intermediador: { cnpj: '03.007.331/0001-41', idCadIntTran: 'meu-nickname-ml' } }),
      );
      expect(payload.indicador_intermediario).toBe(1);
      expect(payload.cnpj_intermediario).toBe('03007331000141');
      expect(payload.id_intermediario).toBe('meu-nickname-ml');
    });
  });

  describe('CEST (benchmark Bling)', () => {
    it('item sem cest: campo omitido do payload', () => {
      const payload = buildNfePayload(buildInput()) as { items: Record<string, unknown>[] };
      expect(payload.items[0].cest).toBeUndefined();
    });

    it('item com cest: propaga o valor para o payload', () => {
      const input = buildInput({ items: [{ ...buildInput().items[0], cest: '2803800' }] });
      const payload = buildNfePayload(input) as { items: Record<string, unknown>[] };
      expect(payload.items[0].cest).toBe('2803800');
    });
  });

  // Quick Win 7 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 2) — finalidade da emissão + documento referenciado.
  describe('finalidade + documentoReferenciado (benchmark Bling, Quick Win 7)', () => {
    it('sem finalidade informada: finalidade_emissao 1 (Normal), sem notas_referenciadas', () => {
      const payload = buildNfePayload(buildInput());
      expect(payload.finalidade_emissao).toBe(1);
      expect(payload.notas_referenciadas).toBeUndefined();
    });

    it('finalidade DEVOLUCAO: finalidade_emissao 4 e CFOP de devolução (5202/6202)', () => {
      const payload = buildNfePayload(
        buildInput({ finalidade: 'DEVOLUCAO', documentoReferenciado: ['1'.repeat(44)] }),
      ) as { finalidade_emissao: number; items: { cfop: string }[] };
      expect(payload.finalidade_emissao).toBe(4);
      // destinatário do fixture é de outro estado (AM) — devolução interestadual
      expect(payload.items[0].cfop).toBe('6202');
    });

    it('finalidade COMPLEMENTAR: finalidade_emissao 2, mantém CFOP de venda normal', () => {
      const payload = buildNfePayload(
        buildInput({ finalidade: 'COMPLEMENTAR', documentoReferenciado: ['1'.repeat(44)] }),
      ) as { finalidade_emissao: number; items: { cfop: string }[] };
      expect(payload.finalidade_emissao).toBe(2);
      expect(payload.items[0].cfop).toBe('6102');
    });

    it('documentoReferenciado presente: vira notas_referenciadas (array de chave_nfe)', () => {
      const chave = '1'.repeat(44);
      const payload = buildNfePayload(buildInput({ finalidade: 'AJUSTE', documentoReferenciado: [chave] })) as {
        notas_referenciadas: { chave_nfe: string }[];
      };
      expect(payload.notas_referenciadas).toEqual([{ chave_nfe: chave }]);
    });

    it('documentoReferenciado com múltiplas chaves: todas viram itens de notas_referenciadas', () => {
      const chaves = ['1'.repeat(44), '2'.repeat(44)];
      const payload = buildNfePayload(buildInput({ finalidade: 'AJUSTE', documentoReferenciado: chaves })) as {
        notas_referenciadas: { chave_nfe: string }[];
      };
      expect(payload.notas_referenciadas).toEqual([{ chave_nfe: chaves[0] }, { chave_nfe: chaves[1] }]);
    });
  });
});
