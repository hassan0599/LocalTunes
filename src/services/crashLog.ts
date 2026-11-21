/**
 * Crash recorder. A fatal JS error closes a release build instantly, with no way to see
 * why. This keeps the last fatal error on disk (synchronously, before React Native's own
 * handler kills the app) so the next launch can show it to the user.
 */
import { File, Paths } from 'expo-file-system';
import { Alert } from 'react-native';

export interface CrashReport {
  time: string;
  message: string;
  stack?: string;
}

const crashFile = () => new File(Paths.document, 'last-crash.json');

let installed = false;

export function installCrashRecorder(): void {
  if (installed || typeof ErrorUtils === 'undefined') return;
  installed = true;
  const defaultHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    if (isFatal) {
      try {
        const e = error instanceof Error ? error : new Error(String(error));
        const report: CrashReport = { time: new Date().toISOString(), message: e.message, stack: e.stack };
        crashFile().writeSync(JSON.stringify(report));
      } catch {
        // Never let the recorder itself get in the way of the original error.
      }
    }
    defaultHandler(error, isFatal);
  });
}

/** Returns and deletes the report left by the previous run, if any. */
export function takeLastCrash(): CrashReport | null {
  try {
    const f = crashFile();
    if (!f.exists) return null;
    const report = JSON.parse(f.textSync()) as CrashReport;
    f.delete();
    return report;
  } catch {
    return null;
  }
}

/** On launch: if the previous run crashed, show what happened (the user can screenshot it). */
export function showLastCrashIfAny(): void {
  const report = takeLastCrash();
  if (!report) return;
  const stack = (report.stack ?? '').split('\n').slice(0, 8).join('\n');
  Alert.alert(
    'LocalTunes closed unexpectedly',
    `Last time, the app stopped because of this error. Please screenshot it and send it to the developer.\n\n${report.time}\n${report.message}\n\n${stack}`,
  );
}
