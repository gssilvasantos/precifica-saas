// Sprint 27 (Pick & Pack) — porta de armazenamento de vídeo em CHUNKS.
// Deliberadamente uma porta NOVA, separada de FileStorage (shared/contracts):
// FileStorage.upload(key, content: Buffer) assume o conteúdo inteiro já em
// memória de uma vez — adequado para fotos/relatórios pequenos, mas
// inaceitável para um vídeo de conferência (poderia ser dezenas de MB,
// gravado ao longo de minutos), onde bufferizar tudo antes de escrever
// jogaria fora exatamente a resiliência pedida (perder o processo no meio
// da gravação perderia o vídeo inteiro, não só o pedaço final). Ver
// docs/pick-pack-architecture.md, seção 2.
export interface VideoChunkAppendResult {
  totalBytes: number;
}

export interface VideoChunkStorage {
  // Garante que o arquivo de destino existe (cria vazio) — chamado uma vez,
  // no início da sessão.
  createSession(key: string): Promise<void>;
  // Faz APPEND do chunk no arquivo já existente — nunca reescreve do zero.
  // Idempotência de sequência (não duplicar um chunk retransmitido) é
  // responsabilidade do CHAMADOR (VideoCaptureService, via canAcceptChunk do
  // domínio) — este port só sabe escrever bytes, sem saber de sequência.
  appendChunk(key: string, content: Buffer): Promise<VideoChunkAppendResult>;
  // Passo 3 (Deploy Demo/R2) — fecha a sessão de escrita e retorna a URL
  // pública DEFINITIVA. Chamado uma única vez, pelo VideoCaptureService.finalize(),
  // depois do último chunk. Introduzido porque o adapter R2
  // (R2VideoChunkStorageService) usa Multipart Upload do S3 por baixo dos
  // panos — o objeto só existe/fica legível no bucket depois de um
  // CompleteMultipartUpload explícito, que é assíncrono e pode falhar (ao
  // contrário do disco local, onde cada appendChunk já commita o byte na
  // hora). getPublicUrl (abaixo) continua existindo só por compatibilidade,
  // mas NÃO garante que o objeto esteja completo no storage antes de
  // finalizeSession ter sido chamado com sucesso.
  finalizeSession(key: string): Promise<string>;
  // URL pública final — usada pelo adapter local (onde não há nenhum passo
  // de "completar" pendente) e por finalizeSession internamente.
  getPublicUrl(key: string): string;
  // Apaga o arquivo físico (retenção de 30 dias) — idempotente: nunca lança
  // se o arquivo já não existir (job de limpeza pode rodar sobre uma sessão
  // já limpa antes por qualquer motivo).
  delete(key: string): Promise<void>;
}

export const VIDEO_CHUNK_STORAGE = Symbol('VIDEO_CHUNK_STORAGE');
