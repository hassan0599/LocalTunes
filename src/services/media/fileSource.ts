import type { File } from 'expo-file-system';

import type { ByteSource } from './tags';

/**
 * Adapts an expo-file-system File to the tag reader's ByteSource.
 * Call `close()` when done.
 */
export function openByteSource(file: File): ByteSource & { close(): void } {
  const handle = file.open();
  const size = handle.size ?? file.size ?? 0;
  return {
    size,
    async read(offset, length) {
      if (offset >= size || length <= 0) return new Uint8Array(0);
      handle.offset = offset;
      return handle.readBytes(Math.min(length, size - offset));
    },
    close() {
      handle.close();
    },
  };
}
