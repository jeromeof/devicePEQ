//
// Copyright 2024 : Pragmatic Audio
//
// DevicePEQ profile files (.devicepeq): a small JSON file describing a PEQ curve that
// apps such as Wifiman Lossless (iOS / macOS) can open. Works from a public HTTPS page:
// no local-network access is needed, the file is downloaded or handed to the share sheet.
//
//   {"format":"devicepeq-profile","version":1,"name":"...","headphone":"...",
//    "preamp":-4.5,"filters":[{"type":"PK","freq":1000,"gain":3,"q":1.5,"disabled":false}]}
//

export const PROFILE_FORMAT = 'devicepeq-profile';
export const PROFILE_VERSION = 1;
export const PROFILE_EXTENSION = 'devicepeq';
export const PROFILE_MIME = 'application/vnd.pragmaticaudio.devicepeq+json';
export const PROFILE_MAX_FILTERS = 15;

/**
 * @param {{name?:string, headphone?:string, preamp?:number, filters:Array}} p
 * @returns {Object} profile object ready to serialise
 */
export function buildProfile({ name, headphone, preamp = 0, filters }) {
  const list = (Array.isArray(filters) ? filters : []).slice(0, PROFILE_MAX_FILTERS).map(f => ({
    type: String(f.type ?? 'PK'),
    freq: Number(f.freq),
    gain: Number(f.gain ?? 0),
    q: Number(f.q ?? 1),
    disabled: !!f.disabled,
  }));
  const profile = {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    name: String(name || 'DevicePEQ profile').slice(0, 80),
    preamp: Number(preamp) || 0,
    filters: list,
  };
  if (headphone) profile.headphone = String(headphone).slice(0, 80);
  return profile;
}

export function profileFileName(profile) {
  const base = profile.name.replace(/[^\w\- .()]+/g, '_').trim() || 'profile';
  return `${base}.${PROFILE_EXTENSION}`;
}

/** Build a File for the profile. */
export function profileToFile(profile) {
  return new File([JSON.stringify(profile, null, 2)], profileFileName(profile), { type: PROFILE_MIME });
}

/**
 * Hand the profile to the OS share sheet where files can be shared (iOS, Android, some desktops);
 * otherwise download it.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareOrDownloadProfile(profile) {
  const file = profileToFile(profile);
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: profile.name });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
