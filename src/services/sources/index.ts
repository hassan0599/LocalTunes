import { internetArchive } from './internetArchive';
import { jamendo } from './jamendo';
import type { MusicSource, SourceId } from './types';

/** Every legal source localtunes knows about (spec 6.4). */
export const SOURCES: MusicSource[] = [internetArchive, jamendo];

export const enabledSources = () => SOURCES.filter((s) => s.enabled);

export function sourceById(id: SourceId): MusicSource {
  const s = SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown source ${id}`);
  return s;
}

export const SOURCE_NAMES: Record<string, string> = {
  imported: 'Imported',
  device: 'On this phone',
  internet_archive: 'Internet Archive',
  jamendo: 'Jamendo',
};
