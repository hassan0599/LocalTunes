// Lets Android Auto (and other media controllers: Wear OS, Assistant) connect to playback.
//
// expo-audio's playback service is a media3 MediaSessionService, which also answers the
// classic `android.media.browse.MediaBrowserService` binding Android Auto uses. Its config
// plugin declares the service unexported with only the media3 intent filter, so this plugin
// exports it and adds the browser action. It works whichever plugin runs first: if the
// service isn't declared yet, it adds the same declaration expo-audio would.
// The `com.google.android.gms.car.application` meta-data lives in modules/now-playing.
const { withAndroidManifest } = require('expo/config-plugins');

const SERVICE = 'expo.modules.audio.service.AudioControlsService';
const ACTIONS = ['androidx.media3.session.MediaSessionService', 'android.media.browse.MediaBrowserService'];

function withAndroidAuto(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('withAndroidAuto: no <application> in AndroidManifest.xml');
    app.service = app.service ?? [];
    let service = app.service.find((s) => s.$?.['android:name'] === SERVICE);
    if (!service) {
      service = { $: { 'android:name': SERVICE, 'android:foregroundServiceType': 'mediaPlayback' }, 'intent-filter': [{ action: [] }] };
      app.service.push(service);
    }
    service.$['android:exported'] = 'true';
    service['intent-filter'] = service['intent-filter']?.length ? service['intent-filter'] : [{ action: [] }];
    const filter = service['intent-filter'][0];
    filter.action = filter.action ?? [];
    for (const name of ACTIONS) {
      if (!filter.action.some((a) => a.$?.['android:name'] === name)) filter.action.push({ $: { 'android:name': name } });
    }
    return cfg;
  });
}

module.exports = withAndroidAuto;
