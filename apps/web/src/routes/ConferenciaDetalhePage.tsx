import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveAuditEvent,
  appendVideoChunk,
  fetchAuditEvent,
  fetchChecklist,
  fetchVideoSession,
  finalizeVideoSession,
  markDivergent,
  scanItem,
  startVideoSession,
  type ChecklistItem,
  type VideoCaptureSession,
} from '../features/logistics-fulfillment/audit-events-api';
import { fetchProducts } from '../features/catalog/api';
import { ensureAudioUnlocked, playChecklistCompleteChime, playScanErrorTone, playScanSuccessTone } from '../lib/audio-feedback';
import { retryWithBackoff } from '../lib/retry';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

// Sprint 27 (Pick & Pack) — a tela é o "juiz" pedido pelo usuário: mostra o
// checklist com fotos, grava a conferência em vídeo (MediaDevices API +
// MediaRecorder com upload incremental em chunks, ver
// docs/pick-pack-architecture.md) e só libera "Finalizar Embalagem" quando
// 100% dos itens estiverem bipados E o vídeo já tiver sido finalizado. A
// fonte de verdade do gate continua sendo o backend (canApprove) — este
// espelho no frontend é só UX, nunca segurança.
export default function ConferenciaDetalhePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const eventQuery = useQuery({
    queryKey: ['audit-event', eventId],
    queryFn: () => fetchAuditEvent(eventId!),
    enabled: !!eventId,
  });
  const checklistQuery = useQuery({
    queryKey: ['audit-event-checklist', eventId],
    queryFn: () => fetchChecklist(eventId!),
    enabled: !!eventId,
  });
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
  const videoSessionQuery = useQuery({
    queryKey: ['audit-event-video-session', eventId],
    queryFn: () => fetchVideoSession(eventId!),
    enabled: !!eventId,
  });

  const [skuInput, setSkuInput] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [divergenceNotes, setDivergenceNotes] = useState('');
  const [showDivergenceForm, setShowDivergenceForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // --- Feedback visual/sonoro de bipagem (Sprint 27, Item 2) -------------
  // `justScannedSku` acende um flash verde breve na linha recém-bipada;
  // `inputShake` toca a animação de tremor no campo quando o SKU é
  // rejeitado. Ambos são só UX — nunca alteram o resultado real da bipagem,
  // que continua vindo 100% do backend (scanMutation).
  const [justScannedSku, setJustScannedSku] = useState<string | null>(null);
  const [inputShake, setInputShake] = useState(false);

  const scanMutation = useMutation({
    mutationFn: (skuCode: string) => scanItem(eventId!, skuCode),
    onSuccess: (updatedItem) => {
      setScanError(null);
      setSkuInput('');
      queryClient.invalidateQueries({ queryKey: ['audit-event-checklist', eventId] });

      playScanSuccessTone();
      setJustScannedSku(updatedItem.skuCode);
      setTimeout(() => setJustScannedSku((current) => (current === updatedItem.skuCode ? null : current)), 900);
    },
    onError: (error: unknown) => {
      setScanError(extractErrorMessage(error));
      playScanErrorTone();
      setInputShake(true);
      setTimeout(() => setInputShake(false), 400);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (lines: { skuCode: string; quantity: number }[]) => approveAuditEvent(eventId!, lines),
    onSuccess: () => navigate('/conferencia'),
    onError: (error: unknown) => setActionError(extractErrorMessage(error)),
  });

  const divergentMutation = useMutation({
    mutationFn: (notes: string) => markDivergent(eventId!, notes),
    onSuccess: () => navigate('/conferencia'),
    onError: (error: unknown) => setActionError(extractErrorMessage(error)),
  });

  // --- Captura de vídeo (MediaDevices + MediaRecorder, chunked) ---
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sequenceRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const pendingUploadsRef = useRef<Promise<unknown>[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizingVideo, setIsFinalizingVideo] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Sprint 27, Item 3 (análise de gargalo) — gap real encontrado: um chunk
  // que falha definitivamente (mesmo após retry) deixa uma lacuna de
  // sequência que o servidor nunca mais fecha (canAcceptChunk rejeita todo
  // chunk seguinte como "fora de ordem"). Sob 20 operadores disputando a
  // mesma rede da doca, uma falha transitória de upload deixa de ser rara.
  // `videoSessionCorrupted` é o estado explícito que impede o "Finalizar
  // Embalagem" de aceitar silenciosamente um vídeo truncado — força o
  // operador a usar "Reportar divergência" em vez disso.
  const [videoSessionCorrupted, setVideoSessionCorrupted] = useState(false);

  const videoSession: VideoCaptureSession | null = videoSessionQuery.data ?? null;
  const videoAlreadyFinalized = videoSession?.status === 'FINALIZED';

  // Trava contra disparo duplicado do auto-start (ver useEffect abaixo) —
  // sem isso, duas bipagens rápidas antes do getUserMedia resolver
  // chamariam startRecording() duas vezes. Reaberta (false) se a câmera
  // falhar, para que o botão manual (fallback) possa tentar de novo.
  const recordingRequestedRef = useRef(false);

  // Encerra a câmera se o operador sair da tela no meio de uma gravação —
  // nunca deixa o MediaStream aberto pendurado no navegador.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startRecording() {
    if (!eventId || recordingRequestedRef.current) return;
    recordingRequestedRef.current = true;
    setCameraError(null);
    try {
      // Sprint 27, Item 3 — resolução/framerate contidos de propósito: isto
      // é vídeo de AUDITORIA (comprovar que a embalagem/bipagem aconteceu
      // como deveria), não gravação cinematográfica. Sem essa restrição,
      // `getUserMedia({video:true})` deixa o navegador escolher a resolução
      // "ideal" da câmera (facilmente 1080p+), multiplicando o bitrate — e,
      // com 20 operadores gravando ao mesmo tempo na mesma rede da doca, é
      // exatamente o que satura o uplink e gera as falhas de upload que o
      // resto desta função agora trata via retry.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }

      const session = await startVideoSession(eventId);
      sessionIdRef.current = session.id;
      sequenceRef.current = 0;
      pendingUploadsRef.current = [];
      setVideoSessionCorrupted(false);
      queryClient.setQueryData(['audit-event-video-session', eventId], session);

      const mimeType = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(
        (type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
      );
      // videoBitsPerSecond baixo (~500kbps) de propósito — mesma lógica da
      // resolução acima: reduz em ~5x a banda de upload exigida por operador
      // frente ao default do navegador, o principal fator sob controle do
      // código para a preocupação de rede com 20 gravações simultâneas.
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 500_000,
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0 || !sessionIdRef.current) return;
        const sequence = sequenceRef.current;
        sequenceRef.current += 1;
        const chunkSessionId = sessionIdRef.current;

        // Retry com backoff antes de desistir do chunk — cobre a falha
        // transitória de rede (o cenário real de 20 operadores disputando o
        // mesmo uplink). Só depois de esgotar as tentativas é que tratamos
        // como corrupção definitiva da sessão (abaixo).
        const upload = retryWithBackoff(() => appendVideoChunk(eventId, chunkSessionId, sequence, e.data), {
          retries: 3,
          baseDelayMs: 600,
        }).catch((err) => {
          // Chunk definitivamente perdido: sequenceRef já avançou, então
          // TODO chunk seguinte será rejeitado pelo servidor como "fora de
          // ordem" (canAcceptChunk) — continuar gravando só produziria mais
          // rejeições silenciosas e um vídeo truncado que passaria no
          // `canFinalize` (que só exige >=1 chunk recebido, não "todos").
          // Em vez de deixar isso acontecer, paramos a captura na hora e
          // bloqueamos a finalização — o operador é direcionado para
          // "Reportar divergência", o mecanismo que já existe pra exceção
          // operacional que o gate automático não resolve sozinho.
          setVideoSessionCorrupted(true);
          setCameraError(
            `Chunk de vídeo (sequence ${sequence}) não pôde ser enviado após 3 tentativas: ${extractErrorMessage(err)}. ` +
              'A gravação foi interrompida para não gerar um vídeo incompleto — reporte a divergência.',
          );
          if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
          }
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          setIsRecording(false);
        });
        pendingUploadsRef.current.push(upload);
      };

      // timeslice de 3s — cada pedaço já sai do navegador e é gravado no
      // disco do servidor assim que chega, sem esperar o fim da gravação
      // inteira (é a resiliência pedida: travar no meio não perde tudo).
      recorder.start(3000);
      setIsRecording(true);
    } catch (error) {
      // Libera a trava — o operador pode tentar de novo pelo botão manual
      // (ex.: negou a permissão da câmera sem querer na primeira vez).
      recordingRequestedRef.current = false;
      setCameraError(`Não foi possível acessar a câmera: ${extractErrorMessage(error)}`);
    }
  }

  async function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || !eventId || !sessionIdRef.current) return;

    setIsFinalizingVideo(true);
    try {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      await Promise.all(pendingUploadsRef.current);

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setIsRecording(false);

      const finalized = await finalizeVideoSession(eventId, sessionIdRef.current);
      queryClient.setQueryData(['audit-event-video-session', eventId], finalized);
    } catch (error) {
      setCameraError(`Falha ao finalizar a gravação: ${extractErrorMessage(error)}`);
    } finally {
      setIsFinalizingVideo(false);
    }
  }

  const event = eventQuery.data;
  const checklist = checklistQuery.data ?? [];
  const products = productsQuery.data ?? [];

  // Espelha exatamente isFullyScanned do backend (domain/stock-movement-audit-event.entity.ts):
  // uma lista VAZIA é vacuamente aprovada (reabastecimento preventivo, sem
  // pedido nenhum atrás) — antes este espelho de UX exigia length > 0 e
  // bloqueava esse caso por engano. Fonte de verdade continua sendo
  // canApprove no backend; isto é só o mesmo cálculo, replicado para UX.
  const checklistComplete = checklist.every((item) => item.scannedQuantity >= item.expectedQuantity);
  const canFinalize =
    checklistComplete && videoAlreadyFinalized && !videoSessionCorrupted && !approveMutation.isPending;

  const totalExpected = checklist.reduce((sum, item) => sum + item.expectedQuantity, 0);
  const totalScanned = checklist.reduce((sum, item) => sum + Math.min(item.scannedQuantity, item.expectedQuantity), 0);
  const progressPct = totalExpected > 0 ? Math.round((totalScanned / totalExpected) * 100) : 100;
  const hasScannedAtLeastOne = checklist.some((item) => item.scannedQuantity > 0);

  // --- Auto-início da gravação (Item 2 da fila) ---------------------------
  // "o vídeo comece a ser gravado no momento em que ele bipa o primeiro
  // item" — reage ao ESTADO real do checklist (fonte: servidor), não ao
  // clique do botão manual. Também cobre o caso de retomar uma conferência
  // (refresh no meio da bipagem) sem sessão de vídeo ainda ativa.
  useEffect(() => {
    if (hasScannedAtLeastOne && !isRecording && !videoAlreadyFinalized) {
      void startRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasScannedAtLeastOne, videoAlreadyFinalized]);

  // --- Chime + banner ao atingir 100% -------------------------------------
  const prevCompleteRef = useRef(false);
  const [showCompleteBanner, setShowCompleteBanner] = useState(false);
  useEffect(() => {
    if (checklistComplete && checklist.length > 0 && !prevCompleteRef.current) {
      prevCompleteRef.current = true;
      playChecklistCompleteChime();
      setShowCompleteBanner(true);
      const timer = setTimeout(() => setShowCompleteBanner(false), 2600);
      return () => clearTimeout(timer);
    }
    if (!checklistComplete) {
      prevCompleteRef.current = false;
    }
  }, [checklistComplete, checklist.length]);

  function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Destrava o AudioContext de forma síncrona dentro deste gesto real do
    // usuário (submit) — os tons tocados depois, dentro do onSuccess/onError
    // assíncrono da mutation, dependem disso (ver lib/audio-feedback.ts).
    ensureAudioUnlocked();
    const sku = skuInput.trim();
    if (!sku) return;
    scanMutation.mutate(sku);
  }

  function handleFinalize() {
    const lines = checklist.map((item) => ({ skuCode: item.skuCode, quantity: item.scannedQuantity }));
    approveMutation.mutate(lines);
  }

  if (eventQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando evento de conferência…</p>;
  }
  if (!event) {
    return <p className="text-sm text-margin-danger">Evento de conferência não encontrado.</p>;
  }

  if (event.conferenceStatus !== 'PENDENTE') {
    return (
      <Card className="p-6">
        <h1 className="font-serif text-2xl font-semibold text-foreground">Conferência já decidida</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este evento já está <strong className="text-foreground">{event.conferenceStatus}</strong> e não pode ser
          reaberto nesta tela.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Conferência de Expedição</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {event.orderIds.length > 0 ? `${event.orderIds.length} pedido(s) vinculado(s)` : 'Reabastecimento preventivo'}{' '}
          — bipe cada item e grave a conferência em vídeo antes de finalizar a embalagem.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Checklist com fotos */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg font-semibold text-foreground">Checklist de bipagem</h2>
            {checklist.length > 0 && (
              <span className="font-sans text-xs font-semibold text-muted-foreground">
                {totalScanned} / {totalExpected} un.
              </span>
            )}
          </div>

          {checklist.length > 0 && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300 ease-out',
                  checklistComplete ? 'bg-margin-good' : 'bg-neon',
                )}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}

          <form onSubmit={handleScanSubmit} className="mt-3 flex gap-2">
            <input
              autoFocus
              value={skuInput}
              onChange={(e) => setSkuInput(e.target.value)}
              placeholder="Bipe ou digite o SKU e pressione Enter"
              className={cn(
                'flex-1 rounded-md border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2',
                inputShake
                  ? 'animate-shake border-margin-danger focus-visible:ring-margin-danger'
                  : 'border-input focus-visible:ring-ring',
              )}
            />
            <Button type="submit" disabled={scanMutation.isPending}>
              Bipar
            </Button>
          </form>
          {scanError && <p className="mt-2 text-xs text-margin-danger">{scanError}</p>}

          {showCompleteBanner && (
            <div className="animate-neonPulse mt-3 rounded-lg bg-neon-dim px-3 py-2 text-xs font-semibold text-foreground">
              Checklist 100% concluído — pode seguir para a gravação/finalização.
            </div>
          )}

          <div className="mt-4 space-y-2">
            {checklist.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum item no checklist deste evento (reabastecimento preventivo — aprovação depende só da mídia).
              </p>
            )}

            {checklist.map((item) => (
              <ChecklistRow
                key={item.id}
                item={item}
                photoUrl={products.find((p) => p.skuCode === item.skuCode)?.photoUrls[0]}
                justScanned={item.skuCode === justScannedSku}
              />
            ))}
          </div>
        </Card>

        {/* Auditoria visual em vídeo */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg font-semibold text-foreground">Auditoria visual (vídeo)</h2>
            {isRecording && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-margin-danger">
                <span className="h-2 w-2 animate-recPulse rounded-full bg-margin-danger" />
                Gravando
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {checklist.length > 0
              ? 'A gravação começa sozinha assim que você bipar o primeiro item. Retenção de 30 dias.'
              : 'A gravação fica vinculada automaticamente a este evento. Retenção de 30 dias.'}
          </p>

          <div className="relative mt-3">
            <video
              ref={videoPreviewRef}
              autoPlay
              muted
              playsInline
              className={cn('aspect-video w-full rounded-xl bg-ink-900 object-cover', isRecording && 'ring-2 ring-margin-danger')}
            />
          </div>

          {cameraError && <p className="mt-2 text-xs text-margin-danger">{cameraError}</p>}

          {videoSessionCorrupted && (
            <div className="mt-2 rounded-lg border border-margin-danger bg-margin-danger/10 px-3 py-2 text-xs font-semibold text-margin-danger">
              Gravação comprometida por falha de rede — "Finalizar Embalagem" foi bloqueado. Use "Reportar
              divergência" abaixo em vez de tentar aprovar este evento.
            </div>
          )}

          <div className="mt-3 flex items-center gap-3">
            {!isRecording && !videoAlreadyFinalized && (
              <Button onClick={startRecording}>
                {hasScannedAtLeastOne ? 'Tentar câmera novamente' : 'Iniciar gravação manualmente'}
              </Button>
            )}
            {isRecording && (
              <Button
                onClick={stopRecording}
                disabled={isFinalizingVideo}
                className="bg-margin-danger text-white hover:bg-margin-danger/90"
              >
                {isFinalizingVideo ? 'Finalizando…' : 'Parar gravação'}
              </Button>
            )}
            {videoAlreadyFinalized && (
              <span className="rounded-full bg-margin-good/15 px-3 py-1 text-xs font-medium text-margin-good">
                Vídeo anexado ✓
              </span>
            )}
          </div>
        </Card>
      </div>

      {actionError && <p className="text-sm text-margin-danger">{actionError}</p>}

      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">
          {videoSessionCorrupted && 'Gravação comprometida por falha de rede — reporte a divergência. '}
          {!videoSessionCorrupted && !checklistComplete && checklist.length > 0 && 'Ainda faltam itens a bipar. '}
          {!videoSessionCorrupted &&
            !videoAlreadyFinalized &&
            !isRecording &&
            'Bipe o primeiro item para a gravação começar automaticamente. '}
          {!videoSessionCorrupted &&
            !videoAlreadyFinalized &&
            isRecording &&
            'Gravando — clique em "Parar gravação" quando a embalagem estiver pronta. '}
          {canFinalize && 'Tudo certo — pode finalizar a embalagem.'}
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setShowDivergenceForm((v) => !v)}>
            Reportar divergência
          </Button>
          <Button onClick={handleFinalize} disabled={!canFinalize}>
            Finalizar Embalagem
          </Button>
        </div>
      </Card>

      {showDivergenceForm && (
        <Card className="p-5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Motivo da divergência</label>
          <textarea
            value={divergenceNotes}
            onChange={(e) => setDivergenceNotes(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Ex.: faltou 1 unidade do SKU-123 no lote físico"
          />
          <Button
            onClick={() => divergentMutation.mutate(divergenceNotes)}
            disabled={!divergenceNotes.trim() || divergentMutation.isPending}
            className="mt-2 bg-margin-danger text-white hover:bg-margin-danger/90"
          >
            Confirmar divergência
          </Button>
        </Card>
      )}
    </div>
  );
}

function ChecklistRow({
  item,
  photoUrl,
  justScanned,
}: {
  item: ChecklistItem;
  photoUrl?: string;
  justScanned?: boolean;
}) {
  const done = item.scannedQuantity >= item.expectedQuantity;

  return (
    <div
      className={cn('flex items-center gap-3 rounded-xl border border-border px-3 py-2', justScanned && 'animate-scanFlash')}
    >
      {photoUrl ? (
        <img src={photoUrl} alt={item.skuCode} className="h-12 w-12 rounded-lg object-cover" />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
          sem foto
        </div>
      )}

      <div className="flex-1">
        <p className="font-sans text-sm font-medium text-foreground">{item.skuCode}</p>
        <p className="text-xs text-muted-foreground">
          {item.scannedQuantity} / {item.expectedQuantity} bipado(s)
        </p>
      </div>

      <span
        className={[
          'rounded-full px-2 py-0.5 text-[10px] font-semibold',
          done ? 'bg-margin-good/15 text-margin-good' : 'bg-margin-warning/15 text-margin-warning',
        ].join(' ')}
      >
        {done ? 'OK' : 'pendente'}
      </span>
    </div>
  );
}

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string | string[] } } }).response;
    const message = response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (message) return message;
  }
  if (error instanceof Error) return error.message;
  return 'Erro inesperado.';
}
