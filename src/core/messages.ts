/** Contrat des messages runtime popup ↔ service worker. */
export const MSG_FETCH_PENDING_IMAGE = 'fetch-pending-image';

export interface FetchPendingImageResponse {
  ok: boolean;
  name?: string;
  mime?: string;
  /** Image encodée en base64 (les messages ne transportent pas d'ArrayBuffer). */
  base64?: string;
  error?: string;
}
