# Infraestrutura

## Ambientes

Defina explicitamente quais existem (desenvolvimento, teste, homologação, produção), como se
diferenciam e o que **nunca** pode acontecer em cada um. Comportamento que só aparece em
produção (driver de storage, pooler de banco, HTTPS obrigatório) é fonte crônica de bug —
documente e, quando possível, exercite antes.

## Variáveis e segredos

- Toda variável nova entra no arquivo de exemplo do projeto, com comentário: para que serve,
  como obter, o que acontece se faltar.
- **Falhe alto na inicialização** quando faltar variável obrigatória. Fallback silencioso para
  valor de desenvolvimento em produção é incidente de segurança esperando acontecer.
- Segredo real nunca no repositório, no exemplo, no log ou na documentação.
- Rotação: saiba onde cada segredo vive e como trocá-lo sem downtime.

## Build e deploy

- Build reprodutível: mesma entrada, mesmo artefato. Sem passo manual não documentado.
- Migration roda **antes** da versão nova do código assumir o tráfego — e precisa ser compatível
  com a versão antiga ainda em execução (por isso expand→migrate→contract).
- Deploy tem rollback conhecido **antes** de acontecer. Se o rollback não for possível (migration
  destrutiva já aplicada), isso é uma decisão consciente, escrita.
- Filesystem efêmero: nada de estado persistido em disco local em ambiente de contêiner.

## CI/CD

O mínimo que vale a pena, na ordem: typecheck → lint → testes → build. Sem isso, "passa na
minha máquina" é a única garantia. Adicionar CI onde não existe é melhoria de alto retorno e
baixo risco — mas é uma tarefa própria, não um efeito colateral de outra funcionalidade.

## Dados

- **Backup**: existe? com que frequência? já foi **restaurado** alguma vez? Backup nunca testado
  não é backup.
- Retenção e arquivamento de tabelas que crescem sem parar.
- Cópia de dado de produção para outros ambientes exige anonimização.

## Storage, filas e cache

- Storage de arquivo: adapter por ambiente, URL pública separada do endpoint autenticado,
  limite de tamanho e tipo validados no servidor.
- Fila: garantia de entrega, dead-letter, e o que acontece com mensagem envenenada.
- Cache: chave com escopo de tenant, TTL explícito, e invalidação clara. Cache sem estratégia de
  invalidação é bug com atraso.

## Rollout

- **Feature flag** para funcionalidade arriscada ou de rollout gradual; flag tem dono e data de
  remoção — flag esquecida vira dívida permanente.
- Migração progressiva de comportamento: novo caminho ativo para uma fatia, medição, ampliação.
- Comunicação: mudança que altera comportamento visível precisa de aviso, não de surpresa.

## Limites de conduta

Nunca alterar produção, provisionar recurso pago, rodar migration em banco compartilhado,
mexer em DNS/domínio, ou tocar em serviço externo **sem autorização explícita do usuário**.
Proponha o comando, mostre o que ele faz, deixe a execução para quem tem a decisão.
