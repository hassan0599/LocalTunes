import Constants from 'expo-constants';

export const APP_NAME = 'localtunes';
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** Contact MusicBrainz can reach about this client's traffic (required by their API rules). */
export const MUSICBRAINZ_CONTACT = 'developer.mha@gmail.com';

/**
 * Jamendo API client id (free, from https://devportal.jamendo.com). Set
 * EXPO_PUBLIC_JAMENDO_CLIENT_ID in .env.local; the Jamendo source is off without it.
 */
export const JAMENDO_CLIENT_ID = process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID ?? '';

/** Format required by MusicBrainz: `AppName/version ( contact )`. */
export const MUSICBRAINZ_USER_AGENT = `${APP_NAME}/${APP_VERSION} ( ${MUSICBRAINZ_CONTACT} )`;
