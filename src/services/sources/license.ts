/** Human-readable labels for license URLs (spec 6.4: display the license for every download). */

/** True for Creative Commons and public-domain URLs: the only licenses localtunes offers. */
export function isOpenLicense(url: string | null | undefined): boolean {
  return !!url && /creativecommons\.org\/(licenses|publicdomain)\//i.test(url);
}

/**
 * "http://creativecommons.org/licenses/by-nc-sa/3.0/us/" → "CC BY-NC-SA 3.0"
 * "https://creativecommons.org/publicdomain/zero/1.0/"   → "CC0 1.0"
 * "https://creativecommons.org/publicdomain/mark/1.0/"   → "Public domain"
 */
export function licenseLabel(url: string | null | undefined): string {
  if (!url) return 'Unknown license';
  const pd = /publicdomain\/(zero|mark)\/([\d.]+)?/i.exec(url);
  if (pd) return pd[1].toLowerCase() === 'zero' ? `CC0${pd[2] ? ` ${pd[2]}` : ''}` : 'Public domain';
  const cc = /licenses\/([a-z-]+)\/([\d.]+)?/i.exec(url);
  if (cc) return `CC ${cc[1].toUpperCase()}${cc[2] ? ` ${cc[2]}` : ''}`;
  return 'See license';
}

/** Short plain-language summary shown next to the label. */
export function licenseSummary(url: string | null | undefined): string {
  if (!url) return '';
  const label = licenseLabel(url);
  if (label.startsWith('CC0') || label === 'Public domain') return 'Free to use for any purpose.';
  const parts: string[] = [];
  if (/BY/.test(label)) parts.push('credit the artist');
  if (/NC/.test(label)) parts.push('no commercial use');
  if (/ND/.test(label)) parts.push('no changes');
  if (/SA/.test(label)) parts.push('share alike');
  return parts.length ? `Free to listen and share: ${parts.join(', ')}.` : '';
}
