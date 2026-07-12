// Porta de armazenamento de arquivos — introduzida na Etapa 5 pela decisão
// de "espelhar" as fotos do Olist (baixar e hospedar cópias) em vez de só
// referenciar a URL original. Ver docs/erp-integration-architecture.md, seção 8.
//
// Implementação inicial: disco local (LocalFileStorageService, em
// erp-integration/infrastructure/), servido como estático via /uploads.
// Trocável por S3/R2/GCS depois implementando esta mesma interface — nenhum
// consumidor (ProductPhotoMirrorService) precisa mudar. Mesmo princípio de
// adapter substituível do resto do sistema (docs/platform-architecture.md,
// seção 9 — caminho de extração para microserviço/infra externa).
export interface StoredFile {
  url: string; // URL final, servida pela própria Precifica — nunca a URL original da fonte
  key: string; // caminho/identificador interno do arquivo no storage
}

export interface FileStorage {
  // `content` já vem baixado em memória — quem baixa da fonte externa é o
  // chamador (ex.: ProductPhotoMirrorService fazendo GET na URL do Olist).
  // Esta porta só sabe persistir bytes, não sabe de onde eles vieram.
  upload(key: string, content: Buffer, contentType: string): Promise<StoredFile>;
}
