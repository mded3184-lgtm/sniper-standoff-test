// Перенесення localStorage та IndexedDB сайту між браузерами.
// Кабінет CrazyGames (як і будь-який сайт на Firebase Auth) тримає токен входу
// в IndexedDB, а не в cookies, тому самих cookies недостатньо.
// Обидві функції виконуються всередині сторінки (page.evaluate).

export async function dumpOrigin() {
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const localStorageItems = Object.keys(localStorage).map((name) => ({ name, value: localStorage.getItem(name) }));
  const databases = [];
  const infos = indexedDB.databases ? await indexedDB.databases() : [];
  for (const info of infos) {
    if (!info.name) continue;
    const db = await req(indexedDB.open(info.name));
    const stores = [];
    for (const name of db.objectStoreNames) {
      const store = db.transaction(name, 'readonly').objectStore(name);
      const indexes = [...store.indexNames].map((n) => {
        const i = store.index(n);
        return { name: n, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry };
      });
      const keys = await req(store.getAllKeys());
      const values = await req(db.transaction(name, 'readonly').objectStore(name).getAll());
      stores.push({
        name,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes,
        records: values.map((value, i) => ({ key: store.keyPath == null ? keys[i] : undefined, value })),
      });
    }
    databases.push({ name: info.name, version: db.version, stores });
    db.close();
  }
  return { origin: location.origin, localStorage: localStorageItems, indexedDB: databases };
}

export async function restoreOrigin(dump) {
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  for (const { name, value } of dump.localStorage ?? []) localStorage.setItem(name, value);
  for (const d of dump.indexedDB ?? []) {
    const open = indexedDB.open(d.name, d.version);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const s of d.stores) {
        if (db.objectStoreNames.contains(s.name)) continue;
        const store = db.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
        for (const i of s.indexes) store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
      }
    };
    const db = await req(open);
    for (const s of d.stores) {
      if (!s.records.length) continue;
      const tx = db.transaction(s.name, 'readwrite');
      const store = tx.objectStore(s.name);
      for (const r of s.records) (r.key === undefined || r.key === null ? store.put(r.value) : store.put(r.value, r.key));
      await new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error))));
    }
    db.close();
  }
}

export const countRecords = (dump) =>
  dump.indexedDB.reduce((n, d) => n + d.stores.reduce((m, s) => m + s.records.length, 0), 0);
