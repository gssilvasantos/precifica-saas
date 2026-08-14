import { derivarPerfilFiscal } from './derivacao-fiscal';

// Contexto real: catálogo de 249 SKUs importados do Olist, 246 deles no NCM
// 3304 (cosméticos), estabelecimento em SP, 242 com CEST preenchido.
//
// O CEST NÃO aparece em nenhum teste aqui de propósito — ele não entra na
// inferência. Ver o comentário do módulo.

const DEPOIS_DA_PORTARIA = new Date(Date.UTC(2026, 7, 13)); // 13/08/2026
const ANTES_DA_PORTARIA = new Date(Date.UTC(2026, 2, 15)); // 15/03/2026

describe('derivarPerfilFiscal', () => {
  describe('cosmético em SP, depois da Portaria SRE 94/2025', () => {
    it('classifica como monofásico e FORA da ST', () => {
      const r = derivarPerfilFiscal({ ncm: '3304.10.00', uf: 'SP', at: DEPOIS_DA_PORTARIA });

      expect(r).not.toBeNull();
      expect(r!.monofasico).toBe(true);
      // SP tirou perfumaria e higiene pessoal da ST em 01/04/2026.
      expect(r!.icmsSt).toBe(false);
      // A resposta a "por que este SKU?" tem que ser a norma.
      expect(r!.fonte).toBe('PORTARIA_SRE_94_2025');
    });

    it('aceita NCM com ou sem pontuação', () => {
      const comPonto = derivarPerfilFiscal({ ncm: '3304.10.00', uf: 'SP', at: DEPOIS_DA_PORTARIA });
      const semPonto = derivarPerfilFiscal({ ncm: '33041000', uf: 'SP', at: DEPOIS_DA_PORTARIA });

      expect(semPonto).toEqual(comPonto);
    });

    it.each(['3303', '3304', '3305', '3306', '3307'])(
      'cobre o capítulo %s da Lei 10.147/2000',
      (capitulo) => {
        const r = derivarPerfilFiscal({ ncm: `${capitulo}9999`, uf: 'SP', at: DEPOIS_DA_PORTARIA });

        expect(r!.monofasico).toBe(true);
      },
    );

    it('normaliza a UF', () => {
      expect(derivarPerfilFiscal({ ncm: '33041000', uf: ' sp ', at: DEPOIS_DA_PORTARIA })).not.toBeNull();
    });
  });

  describe('não afirma o que não tem fonte', () => {
    it('ANTES da portaria, não classifica — a ST valia e não temos a lista', () => {
      // Afirmar `false` aqui seria dizer que estava fora da ST quando estava
      // dentro. Devolver null deixa o motor bloquear e alguém decidir.
      expect(derivarPerfilFiscal({ ncm: '3304.10.00', uf: 'SP', at: ANTES_DA_PORTARIA })).toBeNull();
    });

    it('fora de SP, não classifica — ST é estadual e só SP está codificado', () => {
      // A ST dos outros 26 estados é tabela por UF que muda por portaria.
      // Inventar seria pior que não ter.
      expect(derivarPerfilFiscal({ ncm: '3304.10.00', uf: 'PR', at: DEPOIS_DA_PORTARIA })).toBeNull();
      expect(derivarPerfilFiscal({ ncm: '3304.10.00', uf: 'MG', at: DEPOIS_DA_PORTARIA })).toBeNull();
    });

    it('NCM fora dos capítulos conhecidos não é classificado', () => {
      // 6704 (perucas) existe no catálogo real e não é cosmético da Lei
      // 10.147/2000.
      expect(derivarPerfilFiscal({ ncm: '6704.19.00', uf: 'SP', at: DEPOIS_DA_PORTARIA })).toBeNull();
    });

    it('sem NCM, não classifica', () => {
      expect(derivarPerfilFiscal({ ncm: null, uf: 'SP', at: DEPOIS_DA_PORTARIA })).toBeNull();
    });

    it('NCM truncado não classifica — classificaria o produto errado', () => {
      expect(derivarPerfilFiscal({ ncm: '3304', uf: 'SP', at: DEPOIS_DA_PORTARIA })).toBeNull();
    });

    it('UF inválida não classifica', () => {
      expect(derivarPerfilFiscal({ ncm: '33041000', uf: 'XX', at: DEPOIS_DA_PORTARIA })).toBeNull();
    });
  });

  it('NUNCA afirma icmsSt = true por derivação', () => {
    // Trava a decisão de desenho: `true` retira o ICMS da partilha do DAS e
    // BAIXA a alíquota. Nenhuma inferência automática deve produzir imposto
    // menor — só uma classificação manual, com alguém assumindo a decisão.
    const casos = [
      { ncm: '3304.10.00', uf: 'SP', at: DEPOIS_DA_PORTARIA },
      { ncm: '3307.20.90', uf: 'SP', at: DEPOIS_DA_PORTARIA },
      { ncm: '3302.90.99', uf: 'SP', at: DEPOIS_DA_PORTARIA },
    ];

    for (const caso of casos) {
      const r = derivarPerfilFiscal(caso);
      if (r !== null) expect(r.icmsSt).toBe(false);
    }
  });
});
