// Conecta la app con Firebase (cuenta, base de datos y fotos) y ofrece
// a la página la misma interfaz que usaba dentro de Claude (claude.use).
import { initializeApp } from "./lib/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, getDocs, writeBatch
} from "./lib/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence
} from "./lib/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (s) => document.querySelector(s);

const COLS = ["groups", "items", "games", "media", "anime", "manga"];
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

const login = $("#login");
const msg = (t, bad) => { const el = $("#loginMsg"); el.textContent = t || ""; el.classList.toggle("bad", !!bad); };

if (!firebaseConfig || !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("PEGA")) {
  login.hidden = false;
  $("#loginForm").hidden = true;
  msg("Falta conectar la app con Firebase: pega tu configuración en firebase-config.js.", true);
  throw new Error("firebase-config.js sin rellenar");
}

const app = initializeApp(firebaseConfig);
const fs = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// ---------- fotos ----------
const cache = (window.__photoCache = window.__photoCache || {});
const pending = new Set();
let rerenderT = null;
const rerender = () => { clearTimeout(rerenderT); rerenderT = setTimeout(() => { try { if (typeof window.render === "function") window.render(); } catch (e) {} }, 60); };
let currentUid = null;
window.__photo = (id) => {
  if (!id) return GIF;
  if (cache[id]) return cache[id];
  if (currentUid && !pending.has(id)) {
    pending.add(id);
    getDoc(doc(fs, "users", currentUid, "photos", id))
      .then((s) => { if (s.exists()) { cache[id] = s.data().data; rerender(); } })
      .catch(() => {})
      .finally(() => pending.delete(id));
  }
  return GIF;
};

const toDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
async function shrinkData(dataUrl, maxSide, q) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}

const err = (e) => { const c = e && e.code; return { code: c === "permission-denied" ? "invalid_argument" : c === "resource-exhausted" ? "quota_exceeded" : "unavailable", message: (e && e.message) || "" }; };
const wrap = (p) => p.catch((e) => { throw err(e); });

function makeApi(uid) {
  const ref = (r) => ({
    id: r.id, path: r.path,
    set: (d) => wrap(setDoc(r, d)),
    update: (d) => wrap(updateDoc(r, d)),
    delete: () => wrap(deleteDoc(r)),
    get: () => getDoc(r).then((s) => ({ id: s.id, exists: s.exists(), data: () => s.data() }))
  });
  const db = {
    collection(c) {
      const cr = collection(fs, "users", uid, c);
      return {
        path: cr.path,
        doc: (id) => ref(id ? doc(cr, id) : doc(cr)),
        add: async (d) => { const r = doc(cr); await wrap(setDoc(r, d)); return ref(r); },
        onSnapshot(next, onErr) {
          return onSnapshot(cr, { includeMetadataChanges: true },
            (s) => next({ docs: s.docs.map((d) => ({ id: d.id, exists: true, data: () => d.data(), metadata: d.metadata })), size: s.size, empty: s.empty, metadata: s.metadata }),
            (e) => onErr && onErr(err(e)));
        }
      };
    },
    doc: (p) => ref(doc(fs, "users", uid, ...p.split("/")))
  };
  const assets = {
    async upload(blob) {
      let data = await toDataURL(blob);
      if (data.length > 700000) data = await shrinkData(data, 900, 0.75);
      if (data.length > 900000) data = await shrinkData(data, 640, 0.6);
      const r = doc(collection(fs, "users", uid, "photos"));
      await wrap(setDoc(r, { data, createdAt: Date.now() }));
      cache[r.id] = data;
      return { id: r.id, url: data, sizeBytes: data.length, contentType: "image/jpeg" };
    },
    async delete(id) { delete cache[id]; await wrap(deleteDoc(doc(fs, "users", uid, "photos", id))); },
    async list() { return { assets: [], usage: {} }; }
  };
  const user = { isOwner: () => true, canEdit: () => true, can: () => true, id: async () => uid, me: async () => ({ id: uid }) };
  return { db, assets, user };
}

// ---------- copia de seguridad ----------
async function exportAll(uid) {
  const out = { app: "mi-coleccion", version: 1, exportedAt: new Date().toISOString(), collections: {}, photos: {} };
  for (const c of COLS) {
    const s = await getDocs(collection(fs, "users", uid, c));
    out.collections[c] = {};
    s.forEach((d) => { out.collections[c][d.id] = d.data(); });
  }
  const ps = await getDocs(collection(fs, "users", uid, "photos"));
  ps.forEach((d) => { out.photos[d.id] = d.data().data; });
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mi-coleccion-copia-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function importAll(uid, file, say) {
  const j = JSON.parse(await file.text());
  if (!j || !j.collections) throw new Error("Ese archivo no es una copia de Mi Colección.");
  const photos = Object.entries(j.photos || {});
  let n = 0;
  for (const [id, data] of photos) {
    say(`Importando fotos… ${++n}/${photos.length}`);
    await setDoc(doc(fs, "users", uid, "photos", id), { data, createdAt: Date.now() });
    cache[id] = data;
  }
  const ops = [];
  for (const c of COLS) for (const [id, d] of Object.entries(j.collections[c] || {})) ops.push([c, id, d]);
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(fs);
    ops.slice(i, i + 400).forEach(([c, id, d]) => b.set(doc(fs, "users", uid, c, id), d));
    say(`Importando datos… ${Math.min(i + 400, ops.length)}/${ops.length}`);
    await b.commit();
  }
  return { photos: photos.length, docs: ops.length };
}

// ---------- pantalla de acceso ----------
const authErr = (e) => ({
  "auth/invalid-email": "Ese correo no es válido.",
  "auth/missing-password": "Escribe la contraseña.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Pulsa «Entrar».",
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "No hay ninguna cuenta con ese correo. Pulsa «Crear cuenta».",
  "auth/too-many-requests": "Demasiados intentos. Espera un momento y vuelve a probar.",
  "auth/network-request-failed": "Sin conexión. Revisa internet y vuelve a probar.",
  "auth/operation-not-allowed": "Activa «Correo electrónico/contraseña» en Firebase → Authentication."
}[e && e.code] || "No se pudo entrar. Vuelve a intentarlo.");

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim(), pass = $("#loginPass").value;
  const create = e.submitter && e.submitter.id === "loginCreate";
  msg(create ? "Creando tu cuenta…" : "Entrando…");
  try {
    if (create) await createUserWithEmailAndPassword(auth, email, pass);
    else await signInWithEmailAndPassword(auth, email, pass);
    msg("");
  } catch (er) { msg(authErr(er), true); }
});
$("#loginReset").addEventListener("click", async () => {
  const email = $("#loginEmail").value.trim();
  if (!email) { msg("Escribe tu correo arriba y vuelve a pulsar.", true); return; }
  try { await sendPasswordResetEmail(auth, email); msg("Te he enviado un correo para cambiar la contraseña."); }
  catch (er) { msg(authErr(er), true); }
});

// ---------- compartir (enlace de solo lectura) ----------
const viewUid = new URLSearchParams(location.search).get("ver");
const shareRef = (uid) => doc(fs, "users", uid, "settings", "share");
const shareLink = (uid) => location.origin + location.pathname.replace(/index\.html$/, "") + "?ver=" + encodeURIComponent(uid);

function shareUI(uid) {
  const area = $("#shareArea"), st = $("#footStatus");
  const say = (t) => { st.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { if (st.textContent === t) st.textContent = ""; }, 4000); };
  onSnapshot(shareRef(uid), (s) => {
    const on = s.exists() && s.data().public === true;
    area.innerHTML = on
      ? `<span class="shareon">🔗 Compartiendo</span><input type="text" id="shareLink" readonly value="${shareLink(uid)}" aria-label="Enlace para compartir"><button class="link" id="shareCopy" type="button">Copiar enlace</button>${navigator.share ? '<button class="link" id="shareSend" type="button">Enviar…</button>' : ""}<button class="link" id="shareOff" type="button">Dejar de compartir</button>`
      : `<button class="link" id="shareOn" type="button">Compartir mi colección</button>`;
  }, () => {});
  area.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    try {
      if (b.id === "shareOn") { await setDoc(shareRef(uid), { public: true, since: Date.now() }); say("Enlace activado: cópialo y mándalo a quien quieras."); }
      if (b.id === "shareOff") { await setDoc(shareRef(uid), { public: false, since: Date.now() }); say("Has dejado de compartir. El enlace ya no funciona."); }
      if (b.id === "shareCopy") {
        const link = shareLink(uid);
        try { await navigator.clipboard.writeText(link); say("Enlace copiado."); }
        catch (_) { const i = $("#shareLink"); i.focus(); i.select(); say("Mantén pulsado el enlace para copiarlo."); }
      }
      if (b.id === "shareSend") { await navigator.share({ title: "Mi Colección", text: "Mira mi colección", url: shareLink(uid) }).catch(() => {}); }
    } catch (er) { say("No se pudo cambiar. Revisa las reglas de Firebase."); }
  });
}

async function startViewer(uid) {
  window.__booted = true;
  document.body.classList.add("viewer");
  currentUid = uid;
  let ok = false;
  try { const s = await getDoc(shareRef(uid)); ok = s.exists() && s.data().public === true; } catch (_) { ok = false; }
  if (!ok) {
    login.hidden = false; $("#loginForm").hidden = true;
    msg("Esta colección no está compartida ahora mismo. Pide un enlace nuevo a quien te lo pasó.", true);
    return;
  }
  const api = makeApi(uid);
  api.assets = null;
  api.user = { isOwner: () => false, canEdit: () => false, can: () => false, id: async () => null, me: async () => ({}) };
  const foot = $("#appfoot");
  foot.hidden = false;
  foot.innerHTML = '<span class="viewnote">👀 Estás viendo una colección compartida, en modo solo lectura.</span>';
  window.__fbResolve(api);
}

let resolved = false;
if (viewUid) startViewer(viewUid);
else onAuthStateChanged(auth, (u) => {
  window.__booted = true;
  const foot = $("#appfoot");
  if (!u) {
    if (resolved) { location.reload(); return; }
    login.hidden = false; foot.hidden = true;
    return;
  }
  currentUid = u.uid;
  login.hidden = true;
  foot.hidden = false;
  $("#footUser").textContent = u.email || "";
  if (!resolved) { resolved = true; shareUI(u.uid); window.__fbResolve(makeApi(u.uid)); }
});

$("#footLogout").addEventListener("click", () => signOut(auth));
$("#footExport").addEventListener("click", async () => {
  const b = $("#footExport"); b.disabled = true; b.textContent = "Preparando…";
  try { await exportAll(currentUid); } catch (e) { alert("No se pudo crear la copia: " + (e.message || e)); }
  b.disabled = false; b.textContent = "Descargar copia";
});
$("#footImport").addEventListener("click", () => { const f = $("#importFile"); f.value = ""; f.click(); });
$("#importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f || !currentUid) return;
  if (!confirm("Se añadirá a tu app todo lo que haya en la copia (si algo ya existe, se reemplaza). ¿Seguir?")) return;
  const st = $("#footStatus");
  try { const r = await importAll(currentUid, f, (t) => (st.textContent = t)); st.textContent = `Copia importada: ${r.docs} elementos y ${r.photos} fotos.`; rerender(); }
  catch (er) { st.textContent = "No se pudo importar: " + (er.message || er); }
});

// ---------- instalación como app ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
