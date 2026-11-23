// Voice input: speech settings and models, transcriptions the server does in the background.

export type VoiceMode = 'server' | 'browser' | 'off';

// Voice input (Administration → Voice input & AI). apiKey is only ever sent, never received (apiKeySet);
// configuredViaEnv names the fields STT_* fixes (mode, allowBrowser, url, apiKey, model, maxSeconds,
// maxUploadMb, maxParallel, perUserPerHour, timeoutSeconds, vadFilter, chunked, chunkSeconds)
export interface SpeechSettings {
  mode: '' | 'server' | 'browser' | 'off';
  allowBrowser?: boolean;
  url: string;
  apiKey?: string;
  apiKeySet?: boolean;
  apiKeyUnreadable?: boolean;
  clearApiKey?: boolean;
  model: string;
  maxSeconds?: number;
  maxUploadMb?: number;
  maxParallel?: number;
  perUserPerHour?: number;
  timeoutSeconds?: number;
  vadFilter?: boolean;
  // the app sends a recording in pieces while speaking (default on), each at most chunkSeconds long
  chunked?: boolean;
  chunkSeconds?: number;
  configuredViaEnv?: string[];
}

// The models of the Whisper server (GET /admin/voice/models): known and downloaded ones, the one in use,
// downloads under way (speaches tells no progress: running, done or the error)
export interface SpeechModelDownload {
  model: string;
  startedAt: string;
  finishedAt?: string;
  running: boolean;
  error?: string;
}

export interface SpeechModelsInfo {
  model: string;
  reachable: boolean;
  error?: string;
  models: { id: string; sizeMb?: number; downloaded: boolean }[];
  downloads: SpeechModelDownload[];
}

export interface VoiceAdminStatus {
  mode: VoiceMode;
  demo: boolean;
  url?: string;
  model?: string;
  apiKeySet?: boolean;
  maxSeconds: number;
  maxUploadMb: number;
  maxParallel: number;
  perUserPerHour: number;
  timeoutSeconds: number;
  status?: { reachable: boolean; modelReady: boolean; error?: string; checkedAt?: string };
}

// A transcription the server does in the background (lib/transcriptionJobs.ts): a recording in a note
// ("note", its text becomes the caption) or one dictated into the inbox ("inbox", becomes an entry)
export interface TranscriptionJob {
  id: string;
  userId: string;
  kind: 'note' | 'inbox';
  docId?: string;
  blockId?: string;
  mediaId?: string;
  status: 'queued' | 'running' | 'failed';
  /** Why the last attempt failed: failed | timeout (also while it waits for its next attempt) */
  error?: string;
  attempts: number;
  /** When the server tries it again by itself (RFC 3339); for a failed job its next later attempt */
  nextAt?: string;
  /** Parts of an inbox recording */
  pieces?: number;
  createdAt: string;
  updatedAt: string;
}

// The end of a background transcription (TRANSCRIPTION_DONE): text is empty when nothing was heard,
// the recording is gone or the job was discarded; thoughtId names the inbox entry it became
export interface TranscriptionDone {
  id: string;
  kind: 'note' | 'inbox';
  userId: string;
  text: string;
  docId?: string;
  blockId?: string;
  thoughtId?: string;
}
