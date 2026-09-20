import { createContext } from 'react';

// Lo que el selector de regalos necesita del resto de la app sin tener que
// pasarlo por cada panel: `addGift({ name, coins })` agrega un regalo escrito a
// mano al catálogo del navegador y lo devuelve ya limpio (ver giftCatalog.js).
// Sin proveedor (overlays, pruebas), addGift es null y el selector no ofrece
// escribir regalos.
export const GiftCatalogContext = createContext({ addGift: null });
