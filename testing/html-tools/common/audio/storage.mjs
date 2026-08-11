// Browser persistence with honest failure reporting.
//
// Private mode, a full quota and a file:// origin all make localStorage throw or
// silently drop writes. Swallowing that is what makes "it forgot my settings"
// impossible to diagnose, so every write reports whether it landed.

/**
 * @param {string} key localStorage key owned by one tool
 * @returns {{read:()=>object, write:(values:object)=>{ok:boolean,error?:Error}}}
 */
export function createPreferenceStore(key, storage = globalThis.localStorage) {
  return {
    read() {
      try { return JSON.parse(storage.getItem(key) || '{}'); }
      catch { return {}; }
    },
    write(values) {
      try {
        storage.setItem(key, JSON.stringify(values));
        if (storage.getItem(key) == null) throw new Error('the browser discarded the value immediately after writing it');
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    },
  };
}

export function rememberCookie(name, value, days = 365) {
  try {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${days * 86400}; Path=/; SameSite=Lax`;
  } catch { /* cookies may be blocked; the preference store is the primary path */ }
}

export function readCookie(name) {
  try {
    const prefix = `${encodeURIComponent(name)}=`;
    const item = document.cookie.split('; ').find((part) => part.startsWith(prefix));
    return item ? decodeURIComponent(item.slice(prefix.length)) : '';
  } catch { return ''; }
}
