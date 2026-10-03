import { useEffect, useState } from 'react';
import { backendUrl } from './auth';
import { openCookieSettings } from './cookieConsent';
import LegalLinks from './LegalLinks';

// Aviso Legal, Aviso de Privacidad (LFPDPPP, México) y Cookies. El texto
// describe lo que el sitio hace de verdad (qué guarda, con qué proveedores);
// si algo de eso cambia en el código, hay que actualizarlo aquí. El
// responsable y su contacto NO están en el código: vienen de /api/legal-info
// (variables de entorno LEGAL_*), y lo que falte no se muestra.

function useLegalInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`${backendUrl()}/api/legal-info`)
      .then((res) => res.json())
      .then((data) => { if (alive && data?.success) setInfo(data); })
      .catch(() => { if (alive) setInfo({}); });
    return () => { alive = false; };
  }, []);
  return info;
}

function formatDate(day) {
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Page({ eyebrow, title, info, children, onNavigate }) {
  return (
    <div className="min-h-screen text-white flex flex-col items-center p-6 pt-10 font-sans flex-1 overflow-y-auto">
      <article className="theme-surface w-full max-w-3xl p-6 sm:p-8 flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">{eyebrow}</p>
          <h1 className="theme-heading text-2xl font-black">{title}</h1>
          {info?.updatedAt && <p className="text-xs text-gray-500">Última actualización: {formatDate(info.updatedAt)}</p>}
        </header>
        <div className="tkc-legal flex flex-col gap-5 text-sm text-gray-300 leading-relaxed">{children}</div>
        <LegalLinks onNavigate={onNavigate} />
      </article>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="theme-label text-xs uppercase tracking-widest font-black">{title}</h2>
      {children}
    </section>
  );
}

function Contact({ info }) {
  if (!info?.email) return <span>a través de los medios de contacto de esta página</span>;
  return <a className="theme-link theme-link-info !p-0 !text-sm" href={`mailto:${info.email}`}>{info.email}</a>;
}

function Responsible({ info }) {
  if (!info) return <p className="text-gray-500">Cargando datos del responsable…</p>;
  return (
    <ul className="flex flex-col gap-1">
      <li><strong className="text-white">Servicio:</strong> BenjaApis (benjaapis.dev)</li>
      {info.name && <li><strong className="text-white">Responsable:</strong> {info.name}, persona física</li>}
      {info.location && <li><strong className="text-white">Domicilio:</strong> {info.location}</li>}
      {info.email && <li><strong className="text-white">Contacto:</strong> <Contact info={info} /></li>}
    </ul>
  );
}

export function LegalNotice({ onNavigate }) {
  const info = useLegalInfo();
  return (
    <Page eyebrow="Información legal" title="Aviso legal" info={info} onNavigate={onNavigate}>
      <Section title="Quién ofrece el servicio"><Responsible info={info} /></Section>
      <Section title="Qué es BenjaApis">
        <p>BenjaApis es un panel en línea para creadores que transmiten en TikTok LIVE: juegos con regalos, alertas, lectura del chat en voz alta, cola de canciones de Spotify, overlays para OBS y herramientas como ColorDice y el Downloader. Algunas funciones son gratuitas y otras requieren una licencia (prueba gratis o plan de pago).</p>
        <p>BenjaApis no está afiliado, patrocinado ni respaldado por TikTok, ByteDance, Spotify, Google, YouTube ni OBS. Sus nombres y marcas pertenecen a sus dueños y aquí solo se usan para describir con qué funciona el servicio.</p>
      </Section>
      <Section title="Condiciones de uso">
        <p>Al usar el sitio te comprometes a hacerlo de forma lícita, a no intentar acceder a cuentas o datos de otras personas, a no compartir ni revender tu clave de licencia y a no usar el servicio para molestar, engañar o perjudicar a tu audiencia. Una licencia es personal: si se detecta abuso (por ejemplo, varias pruebas gratis con la misma tarjeta o el mismo usuario de TikTok) puede revocarse.</p>
        <p>Eres responsable del contenido que subes a tus alertas (imágenes, audio, video) y de lo que descargas con el Downloader: solo descarga contenido propio o que tengas derecho a usar.</p>
      </Section>
      <Section title="Pagos y reembolsos">
        <p>Los pagos se procesan con Mercado Pago o Stripe; BenjaApis no ve ni guarda los datos de tu tarjeta. Al ser un servicio digital que se entrega al momento, las ventas son finales salvo que la ley aplicable disponga otra cosa. Si tuviste un problema real con un cobro, escríbenos (<Contact info={info} />) antes de iniciar una disputa con tu banco.</p>
      </Section>
      <Section title="Disponibilidad y responsabilidad">
        <p>Hacemos lo posible para que el servicio funcione siempre, pero depende de terceros (TikTok, Spotify, proveedores de pago y de alojamiento) que pueden cambiar o fallar sin aviso. El servicio se ofrece tal cual; no respondemos por pérdidas derivadas de interrupciones ajenas a nosotros.</p>
      </Section>
      <Section title="Propiedad intelectual">
        <p>El diseño, el código y la marca BenjaApis son de su titular. No se permite copiarlos ni redistribuirlos sin autorización.</p>
      </Section>
      <Section title="Ley aplicable">
        <p>Estas condiciones se rigen por las leyes de los Estados Unidos Mexicanos. Cualquier controversia se resolverá ante los tribunales competentes del domicilio del responsable, salvo que la ley disponga otra cosa.</p>
      </Section>
    </Page>
  );
}

export function PrivacyNotice({ onNavigate }) {
  const info = useLegalInfo();
  return (
    <Page eyebrow="Información legal" title="Aviso de privacidad" info={info} onNavigate={onNavigate}>
      <p>Este aviso explica qué datos personales trata BenjaApis, para qué y cómo puedes ejercer tus derechos, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).</p>
      <Section title="Responsable"><Responsible info={info} /></Section>
      <Section title="Qué datos tratamos">
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li><strong className="text-white">De tu licencia:</strong> el alias o usuario que elegiste, el tipo de plan y su vencimiento, la fecha de tu último inicio de sesión y cuántas veces usas cada juego. Tu clave de licencia se guarda como una huella cifrada; la única excepción es la clave nueva que genera una compra, que se guarda hasta que la ves por primera vez y entonces se borra.</li>
          <li><strong className="text-white">De tu transmisión:</strong> el usuario de TikTok al que conectas el panel y, mientras estás en vivo, los eventos públicos de tu LIVE (regalos, seguidores, comentarios y nombres de quienes participan) para mostrar juegos, alertas y lectura del chat. Los eventos recientes se guardan solo en memoria; las listas que tú armas (por ejemplo, a quién lee o no el TTS) se guardan con tu licencia.</li>
          <li><strong className="text-white">De tus pagos:</strong> el identificador y estado del pago, el plan y el monto. Los datos de tu tarjeta los recibe directamente Mercado Pago o Stripe. Para cobrar, el procesador pide además tu correo, nombre y, según el medio, dirección o identificación: nuestro servidor se los entrega al procesador en ese momento y no los guarda; con el pago queda registrada la fecha en que aceptaste la política de reembolsos. En la prueba gratis con tarjeta guardamos una huella de la tarjeta que entrega Stripe (no el número) para evitar pruebas repetidas.</li>
          <li><strong className="text-white">De Spotify (si lo conectas):</strong> tu nombre en Spotify y los permisos de acceso, cifrados, para poder añadir canciones a tu cola.</li>
          <li><strong className="text-white">Lo que subes:</strong> imágenes, audio o video de tus alertas y del objetivo.</li>
          <li><strong className="text-white">Datos técnicos:</strong> la dirección IP se usa al momento para limitar intentos abusivos y no se guarda. Si algo falla, guardamos un reporte del error (qué pasó, en qué página y con qué navegador) para corregirlo. Las visitas se cuentan de forma anónima, sin cookies y sin guardar la IP.</li>
        </ul>
        <p>No tratamos datos personales sensibles.</p>
      </Section>
      <Section title="Para qué los usamos">
        <p><strong className="text-white">Finalidades necesarias:</strong> darte acceso con tu licencia, hacer funcionar cada herramienta durante tu transmisión, procesar y conciliar pagos, prevenir el abuso de la prueba gratis, dar soporte y mantener la seguridad del servicio.</p>
        <p><strong className="text-white">Finalidades secundarias:</strong> medir de forma anónima qué páginas se usan para mejorar el sitio, y mostrar anuncios a quien usa las funciones gratuitas sin licencia. Puedes oponerte a los anuncios personalizados en cualquier momento desde «Preferencias de anuncios».</p>
      </Section>
      <Section title="Con quién se comparten">
        <p>No vendemos tus datos. Para dar el servicio los tratan, por cuenta nuestra, estos proveedores: Render (alojamiento del servidor), Supabase (base de datos y archivos), Mercado Pago y Stripe (pagos), Spotify (si lo conectas), Google AdSense y Adsterra (anuncios para visitantes sin licencia) y Google Fonts (tipografías). Algunos están fuera de México; se les exige proteger tus datos. También podemos entregarlos a una autoridad que lo requiera conforme a la ley.</p>
      </Section>
      <Section title="Tus derechos ARCO y cómo revocar tu consentimiento">
        <p>Puedes pedir acceso a tus datos, su rectificación, su cancelación u oponerte a su uso (derechos ARCO), así como revocar tu consentimiento, escribiendo a <Contact info={info} /> desde un medio que nos permita confirmar que la licencia es tuya. Indica qué pides y, si aplica, qué dato corregir. Te responderemos en un máximo de 20 días hábiles y, si procede, lo aplicaremos dentro de los 15 días hábiles siguientes.</p>
        <p>Cancelar tus datos implica eliminar tu licencia y lo que cuelga de ella (alertas, archivos y conexión con Spotify). Los registros de pagos pueden conservarse el tiempo que exija la ley.</p>
      </Section>
      <Section title="Cookies y almacenamiento del navegador">
        <p>Consulta la página de <a href="/cookies" onClick={(e) => { e.preventDefault(); onNavigate?.('cookies'); }} className="theme-link theme-link-info !p-0 !text-sm">Cookies</a>.</p>
      </Section>
      <Section title="Cambios a este aviso">
        <p>Si este aviso cambia, publicaremos la nueva versión en esta misma página con su fecha de actualización.</p>
      </Section>
    </Page>
  );
}

export function CookiesNotice({ onNavigate }) {
  const info = useLegalInfo();
  return (
    <Page eyebrow="Información legal" title="Cookies y almacenamiento" info={info} onNavigate={onNavigate}>
      <Section title="Lo que guarda BenjaApis en tu navegador">
        <p>BenjaApis no crea cookies propias. Usa el almacenamiento local de tu navegador para lo que el panel necesita para funcionar: tu sesión, el tema y la personalización de tus overlays, los borradores de tus juegos, si ya viste la guía de inicio y tu elección sobre los anuncios. Nada de esto se usa para seguirte ni se comparte.</p>
        <p>Las visitas se cuentan en nuestro propio servidor, sin cookies y sin guardar tu dirección IP. Si tu navegador envía la señal «No rastrear» o «Global Privacy Control», no se cuentan.</p>
      </Section>
      <Section title="Cookies de terceros">
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li><strong className="text-white">Anuncios (Google AdSense y Adsterra):</strong> se muestran a quien usa las funciones gratuitas sin licencia, y pueden usar cookies para medir y elegir anuncios. Puedes pedir anuncios no personalizados.</li>
          <li><strong className="text-white">Pagos (Mercado Pago y Stripe):</strong> sus formularios usan cookies propias para prevenir fraude, solo cuando abres un pago.</li>
        </ul>
      </Section>
      <Section title="Cómo elegir">
        <p>Puedes cambiar tu elección sobre los anuncios cuando quieras:</p>
        <div><button type="button" onClick={openCookieSettings} className="theme-btn-secondary theme-btn-md font-black uppercase tracking-widest">Preferencias de anuncios</button></div>
        <p>También puedes borrar o bloquear las cookies desde la configuración de tu navegador; si borras el almacenamiento local, se cerrará tu sesión y volverás al tema de fábrica.</p>
      </Section>
    </Page>
  );
}

// Página 404 personalizada (la dirección no existe). El servidor además
// responde con el código 404.
export function NotFoundPage({ onNavigate }) {
  return (
    <div className="text-white flex flex-col items-center gap-5 px-6 py-16 sm:py-24 font-sans flex-1 text-center">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">Error 404</p>
      <h1 className="theme-heading text-3xl font-black">Esta página no existe</h1>
      <p className="text-sm text-gray-400 max-w-sm">Puede que el enlace esté mal escrito o que la página ya no esté. Tu panel sigue aquí.</p>
      <button type="button" onClick={() => onNavigate('dashboard')} className="theme-btn-primary theme-btn-lg font-black uppercase tracking-widest">
        Ir al inicio
      </button>
    </div>
  );
}
