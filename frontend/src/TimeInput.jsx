import React from 'react';

// Reemplaza los sliders de tiempo por un input numérico (pedido explícito)
// — dos campos chicos de minutos/segundos en vez de un único campo con
// minutos decimales, más fácil de teclear con precisión (ej: "3" y "30"
// en vez de tener que calcular "3.5"). El valor que maneja el caller sigue
// siendo segundos totales (mismo formato que ya usa el backend/estado),
// esto solo cambia cómo se ingresa.
export default function TimeInput({ seconds, onChange, maxSeconds = 5999, disabled = false }) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  const clamp = (v) => Math.max(0, Math.min(maxSeconds, v));

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number" min="0" inputMode="numeric" disabled={disabled}
        value={mins}
        onChange={(e) => onChange(clamp((Number(e.target.value) || 0) * 60 + secs))}
        className="theme-input w-14 p-2 text-center text-sm font-bold outline-none disabled:opacity-50"
      />
      <span className="text-gray-500 font-black text-[10px] uppercase">min</span>
      <input
        type="number" min="0" max="59" inputMode="numeric" disabled={disabled}
        value={secs}
        onChange={(e) => onChange(clamp(mins * 60 + Math.max(0, Math.min(59, Number(e.target.value) || 0))))}
        className="theme-input w-14 p-2 text-center text-sm font-bold outline-none disabled:opacity-50"
      />
      <span className="text-gray-500 font-black text-[10px] uppercase">seg</span>
    </div>
  );
}
