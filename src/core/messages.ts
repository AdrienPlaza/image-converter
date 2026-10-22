/** Runtime message contract between popup ↔ service worker. */
export const MSG_FETCH_PENDING_IMAGE = 'fetch-pending-image';

export interface FetchPendingImageResponse {
  ok: boolean;
  name?: string;
  mime?: string;
  /** Base64-encoded image (messages do not carry ArrayBuffers). */
  base64?: string;
  error?: string;
}
