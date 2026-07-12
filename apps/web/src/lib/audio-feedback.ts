// Feedback sonoro da tela de Conferência (Sprint 27, Item 2 da fila de
// validação em produção — pedido explícito do usuário: "sistema de
// 'feedback' visual e sonoro"). Implementado com a Web Audio API nativa
// (osciladores senoidais gerados on-the-fly) — nenhum arquivo de áudio
// externo para baixar/hospedar, só matemática de onda + envelope de volume.
//
// Política de autoplay dos navegadores: um AudioContext só produz som de
// verdade depois de ser "destravado" por um gesto real do usuário (clique,
// tecla, submit). Por isso `ensureAudioUnlocked()` deve ser chamada de
// forma SÍNCRONA dentro de um handler de evento real (ex.: onSubmit do
// formulário de bipagem, ANTES do await da mutation) — os tons em si podem
// tocar depois, dentro de callbacks assíncronos (onSuccess/onError da
// mutation), porque a essa altura o contexto já está destravado.
let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null; // navegador sem suporte — feedback sonoro vira no-op, nunca quebra a tela
  if (!audioContext) {
    audioContext = new AudioCtor();
  }
  return audioContext;
}

export function ensureAudioUnlocked(): void {
  const ctx = getContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume();
  }
}

// Toca uma sequência de notas (frequências em Hz), cada uma com attack
// rápido e decay suave (evita o "clique" audível de um envelope abrupto).
function playTone(frequencies: number[], durationMs: number, gapMs = 0): void {
  const ctx = getContext();
  if (!ctx) return;

  const startAt = ctx.currentTime;
  frequencies.forEach((freq, index) => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = freq;

    const noteStart = startAt + index * ((durationMs + gapMs) / 1000);
    const noteEnd = noteStart + durationMs / 1000;

    gainNode.gain.setValueAtTime(0, noteStart);
    gainNode.gain.linearRampToValueAtTime(0.2, noteStart + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, noteEnd);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.02);
  });
}

// Bipagem aceita — um bipe curto e agudo, o mesmo timbre familiar de um
// leitor de código de barras de loja física.
export function playScanSuccessTone(): void {
  playTone([880], 90);
}

// Bipagem rejeitada (SKU fora do checklist, já completo, etc.) — dois tons
// graves em sequência, propositalmente diferentes do sucesso para o
// operador perceber o erro sem precisar olhar a tela.
export function playScanErrorTone(): void {
  playTone([220, 180], 140, 30);
}

// Checklist atingiu 100% — arpejo curto ascendente (Dó-Mi-Sol), o sinal de
// "pode seguir para a finalização" mesmo sem olhar a tela.
export function playChecklistCompleteChime(): void {
  playTone([523.25, 659.25, 783.99], 120, 20);
}
