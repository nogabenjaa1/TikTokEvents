import React from 'react';
import AdIframeBanner from './AdIframeBanner';
import { PERSISTENT_BANNER_ZONE } from './adConfig';

// Banner fijo (320x50) que queda siempre presente debajo del historial de
// Color Says mientras `active` es true — a diferencia de InterstitialAd, no
// bloquea nada ni pide esperar: es puro ingreso pasivo mientras se juega.
// Zona propia (aislada en su propio iframe, ver AdIframeBanner.jsx), así
// que puede convivir en pantalla con el interstitial sin pisarse.
export default function AdBanner({ active }) {
  return <AdIframeBanner zone={PERSISTENT_BANNER_ZONE} active={active} />;
}
