# Arquitetura

## Regra zero

**A arquitetura existente vence a preferência pessoal.** Antes de propor qualquer estrutura
nova, mostre onde a atual falha para o caso concreto. Reescrita só com necessidade comprovada,
custo estimado e caminho incremental.

## Fronteiras

- Um módulo/bounded context tem **um dono conceitual** e uma fronteira explícita de import.
- Comunicação entre fronteiras acontece por **contrato** (porta/interface, evento, ou HTTP),
  nunca por acesso direto ao armazenamento do outro lado.
- Dependência aponta para dentro: interface/infraestrutura → aplicação → domínio. Domínio não
  conhece framework, ORM, HTTP nem UI.
- Se dois módulos precisam do mesmo dado, decida: quem é dono, quem lê por porta, e se o leitor
  precisa de um read model próprio.

## Decidindo entre chamada direta e evento

| Use chamada direta (porta) quando | Use evento quando |
|---|---|
| O chamador precisa do resultado para continuar | O efeito é secundário ao caso de uso |
| A consistência precisa ser imediata | Consistência eventual é aceitável |
| A falha deve abortar a operação | A falha deve ser reprocessável isoladamente |
| Há um único consumidor conhecido | Há vários consumidores, ou consumidores futuros |

Evento sem consumidor é ruído. Evento com consumidor crítico e sem garantia de entrega é bug.

## Camadas — quando valem a pena

Nem todo módulo precisa de 4 camadas. O critério: **existe regra de negócio própria?**

- CRUD puro sem invariante → service fino + repositório já basta; não crie entidade anêmica só
  para cumprir ritual.
- Regra, invariante, máquina de estados, cálculo → domínio explícito e testável sem
  infraestrutura.

Mantenha a **consistência com o resto do repositório** acima da pureza teórica: se todos os
módulos têm 4 camadas, o módulo novo tem 4 camadas.

## Acoplamento — sinais de alerta

- Import atravessando a fronteira de outro módulo por caminho profundo.
- Tipo de infraestrutura (modelo do ORM, `Request` do HTTP) vazando para o domínio.
- Serviço que só existe para repassar chamada (indireção sem valor).
- Regra de negócio duplicada em dois lugares — o segundo lugar sempre desatualiza.
- Componente de UI decidindo regra de negócio ("se role === admin então o desconto máximo é…").
- Migration de um contexto mexendo em tabela de outro.

## Evolução

- Prefira **expandir depois contrair**: adicione o novo caminho, migre consumidores, remova o
  antigo. Nunca troque tudo de uma vez em produção.
- Deprecação declarada: marque, documente a data/versão, e só remova quando não houver consumidor.
- Extração para serviço separado só quando houver motivo operacional real (escala, isolamento
  de falha, time separado) — não por estética.

## Decisões

Toda decisão que restringe o futuro vira ADR (`templates/adr.md` → `docs/decisions/`):
escolha de biblioteca, mudança de fronteira, estratégia de dados, modelo de autorização,
mecanismo de integração, abandono de alternativa considerada.
