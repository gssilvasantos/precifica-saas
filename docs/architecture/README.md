# docs/architecture

Documentos de arquitetura: visão da plataforma, bounded contexts, fronteiras entre módulos e
desenho técnico de cada contexto.

## Nesta pasta

- [`claude-engineering-system.md`](./claude-engineering-system.md) — o sistema de engenharia do
  Claude Code neste repositório (skill, regras, subagentes, hooks, fluxo de trabalho).

## Documentos existentes (ainda na raiz de `docs/`)

Os 36 documentos anteriores a esta reorganização **não foram movidos** — mover quebraria
referências cruzadas espalhadas pelo `README.md` e pelos próprios documentos. Continuam válidos
e são a fonte da verdade sobre o produto:

| Documento | Assunto |
|---|---|
| `../platform-architecture.md` | **North star** — visão geral, bounded contexts, regras de acoplamento |
| `../row-level-security-architecture.md` | Isolamento entre tenants (RLS), políticas e grants |
| `../auth-security.md` | Autenticação, OAuth dos canais, criptografia de credenciais |
| `../orders-architecture.md` | Hub de pedidos multicanal |
| `../erp-integration-architecture.md` | Integração com Olist/Tiny e Nuvemshop |
| `../marketplace-intelligence-architecture.md` | Regras de comissão/taxa por canal |
| `../deploy-render-supabase-r2.md` | Deploy: Render + Supabase + Cloudflare R2 |
| *(demais)* | Um documento por módulo — ver `ls docs/` |

**Documento novo de arquitetura vai aqui**, não na raiz de `docs/`.
