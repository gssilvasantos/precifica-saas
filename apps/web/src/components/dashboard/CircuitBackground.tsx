// Textura decorativa "circuitos/conexões" pedida como identidade da marca —
// linhas e nós em azul neon, opacidade baixa o suficiente para nunca
// competir com o texto por cima (pointer-events-none, position absolute).
// Puramente decorativo: sem dado, sem lógica, sem props.
export default function CircuitBackground() {
  return (
    <svg
      viewBox="0 0 800 200"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]"
      aria-hidden="true"
    >
      <g stroke="#00F0FF" strokeWidth="1.2" fill="none">
        <path d="M0 40 H160 L190 70 H420 L450 40 H800" />
        <path d="M0 120 H120 L150 150 H360 L400 110 H620 L650 140 H800" />
        <path d="M60 40 V0 M190 70 V160 M450 40 V0 M150 150 V200 M620 110 V0" />
      </g>
      <g fill="#00F0FF">
        <circle cx="160" cy="40" r="3" />
        <circle cx="420" cy="70" r="3" />
        <circle cx="450" cy="40" r="3" />
        <circle cx="120" cy="120" r="3" />
        <circle cx="360" cy="150" r="3" />
        <circle cx="620" cy="110" r="3" />
        <circle cx="650" cy="140" r="3" />
      </g>
    </svg>
  );
}
