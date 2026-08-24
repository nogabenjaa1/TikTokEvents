import React, { useRef, useState } from 'react';

// Redimensiona la imagen a 200x200 máx (4x los 50px que muestra el overlay:
// aguanta pantallas de alta densidad Y que el overlay se escale hacia
// arriba dentro de la escena de OBS sin verse pixelado). Una fuente de
// 512x512 baja a 200 sin perder nitidez visible a ese tamaño. Devuelve un
// data URL — viaja por socket como un string chico, sin necesidad de subir
// archivos a ningún servidor.
function fileToDataUrl(file, maxSize = 200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      // Interpolación de alta calidad: al bajar de 512 a 200 en un solo paso,
      // sin esto el navegador puede dejar bordes dentados/aliasing.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen inválida')); };
    img.src = url;
  });
}

// Editor del premio de un modo (king/zub/elim): título + imagen opcional
// (arrastrable o clic para elegir). Emite 'update_prize' al backend, que lo
// rebota a todos los clientes (incluido el overlay) vía 'prizes_updated'.
export default function PrizeEditor({ socket, app, prize }) {
  const [title, setTitle] = useState(prize?.title || '');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const debounceRef = useRef(null);
  const image = prize?.image || null;

  const emitPrize = (nextTitle, nextImage) => {
    socket?.emit('update_prize', { app, title: nextTitle, image: nextImage });
  };

  // El título se emite con un pequeño debounce para no mandar un evento de
  // socket por cada tecla presionada.
  const onTitleChange = (value) => {
    setTitle(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => emitPrize(value, image), 400);
  };

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      emitPrize(title, await fileToDataUrl(file));
    } catch {
      // archivo que no es una imagen legible: se ignora sin romper nada
    }
  };

  const clearPrize = () => {
    setTitle('');
    clearTimeout(debounceRef.current);
    emitPrize('', null);
  };

  return (
    <div className="theme-surface p-3 mt-4">
      <label className="block text-[10px] uppercase tracking-widest text-emerald-400 mb-2 font-black">
        🎁 Premio <span className="text-gray-500 normal-case tracking-normal font-semibold">(visible en el overlay, opcional)</span>
      </label>
      <div className="flex items-center gap-3">
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
          title="Arrastrá una imagen acá o hacé clic para elegirla (opcional)"
          className={[
            'w-[50px] h-[50px] rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer flex-shrink-0 overflow-hidden transition-colors',
            dragOver ? 'border-emerald-400 bg-emerald-900/30' : 'border-gray-600 hover:border-emerald-500',
          ].join(' ')}
        >
          {image ? <img src={image} className="w-full h-full object-cover" /> : <span className="text-lg opacity-50">🖼️</span>}
        </div>
        <input
          type="file" accept="image/*" ref={fileRef} className="hidden"
          onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ''; }}
        />
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={60}
          placeholder="ej: $500 MXN / un saludo / una skin"
          className="theme-input flex-1 p-2.5 outline-none text-sm placeholder-gray-600"
        />
        {(title || image) && (
          <button type="button" onClick={clearPrize} title="Quitar premio"
            className="text-red-400 hover:text-red-300 text-sm font-bold flex-shrink-0">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
