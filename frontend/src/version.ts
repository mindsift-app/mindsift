declare const __APP_VERSION__: string;

/** Version shown in the header; set at build time in vite.config.ts. */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

declare const __APP_BUILD__: string;

/** ID of this build; version.json on the server names the build that is live now. */
export const APP_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '';
