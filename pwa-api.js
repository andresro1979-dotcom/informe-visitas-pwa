// ==================== PWA <-> Google Apps Script ====================
// Reemplaza a google.script.run (que solo existe dentro del iframe de GAS) por fetch() al
// segundo deployment (acceso público + token) creado para esta PWA. Ver Code.js: doPost /
// doGet con "accion". El deployment de oficina (sin "accion") no se toca.
const API_URL = 'https://script.google.com/macros/s/AKfycbw86Ur56UZ0MKDAABbU0b86DyWAPwf1BtZ1MPN_2Q9Mnz7SMgE_616zu15IHPUyWWgJSQ/exec';
const API_TOKEN = 'ZOrKIzIw1bn9VKMXU0Ph56OvI3VNoCP';

// ---------- Caché de lectura (localStorage): lo último visto, para abrir la app sin señal ----------
function leerCache_(clave, porDefecto) {
  try {
    const crudo = localStorage.getItem('cache_' + clave);
    return crudo ? JSON.parse(crudo) : porDefecto;
  } catch (e) {
    return porDefecto;
  }
}

function guardarCache_(clave, valor) {
  try { localStorage.setItem('cache_' + clave, JSON.stringify(valor)); } catch (e) { /* localStorage lleno o bloqueado: sin caché, no es fatal */ }
}

async function obtenerApiGet_(accion) {
  const url = API_URL + '?accion=' + encodeURIComponent(accion) + '&token=' + encodeURIComponent(API_TOKEN);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Error del servidor (' + resp.status + ')');
  const json = await resp.json();
  if (json && json.ok === false) throw new Error(json.error || 'Error desconocido');
  return json;
}

// Refresca Historial/Clientes/Pendientes/Presupuestos/Expedientes TE1 contra la API y reemplaza
// la caché local. Si no hay conexión (o la API no responde), se queda con lo último guardado.
async function refrescarDatosSiHayConexion_() {
  if (!navigator.onLine) { mostrarBannerOffline_(true); return; }
  try {
    const [historial, clientes, pendientes, presupuestos, expedientesTE1] = await Promise.all([
      obtenerApiGet_('historial'),
      obtenerApiGet_('clientes'),
      obtenerApiGet_('pendientesPresupuesto'),
      obtenerApiGet_('presupuestosGenerados'),
      obtenerApiGet_('expedientesSEC')
    ]);
    HISTORIAL_INICIAL = historial;
    PENDIENTES_PRESUPUESTO = pendientes;
    PRESUPUESTOS_GENERADOS = presupuestos;
    CLIENTES_GUARDADOS = clientes;
    EXPEDIENTES_TE1 = expedientesTE1;
    reconstruirIndicesClientes_();
    guardarCache_('historial', historial);
    guardarCache_('clientes', clientes);
    guardarCache_('pendientesPresupuesto', pendientes);
    guardarCache_('presupuestosGenerados', presupuestos);
    guardarCache_('expedientesTE1', expedientesTE1);
    mostrarBannerOffline_(false);
    if (typeof cargarPresupuestosGenerados_ === 'function') cargarPresupuestosGenerados_();
    if (typeof cargarHistorialCombinado_ === 'function') cargarHistorialCombinado_();
    if (typeof refrescarListaExpedientesTE1_ === 'function') refrescarListaExpedientesTE1_();
  } catch (e) {
    mostrarBannerOffline_(true);
  }
}

function mostrarBannerOffline_(mostrar) {
  const banner = document.getElementById('banner-offline');
  if (banner) banner.style.display = mostrar ? 'block' : 'none';
}

// ---------- Outbox offline (IndexedDB: las fotos+firma en base64 pueden pesar varios MB) ----------
// Cada elemento: {clave, accion, data, creado, codigoLocalRef?}. "accion" es el nombre de la
// acción del backend (guardarInforme, guardarExpedienteTE1, subirDocumentoTE1...) — así un solo
// outbox sirve para cualquier tipo de guardado offline, no solo informes.
const DB_NAME_ = 'informe_visita_offline';
const STORE_OUTBOX_ = 'outbox';

function abrirDB_() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME_, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OUTBOX_)) db.createObjectStore(STORE_OUTBOX_, { keyPath: 'clave' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// codigoLocalRef: solo lo usan los documentos de un Expediente TE1 creado offline — referencia
// la "clave" local del expediente del que dependen, porque su "codigo" real todavía no existe
// (lo asigna el servidor recién al sincronizar). Se resuelve en resolverDependientesTE1_.
async function encolarOffline_(accion, data, codigoLocalRef) {
  const db = await abrirDB_();
  const clave = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const item = { clave, accion, data, creado: Date.now() };
  if (codigoLocalRef) item.codigoLocalRef = codigoLocalRef;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX_, 'readwrite');
    tx.objectStore(STORE_OUTBOX_).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  actualizarBadgeSync_();
  return { ok: true, id: clave, clave: clave, pdfUrl: '', pendienteSync: true, accion: accion };
}

async function listarOutbox_() {
  const db = await abrirDB_();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_OUTBOX_, 'readonly').objectStore(STORE_OUTBOX_).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function quitarDeOutbox_(clave) {
  const db = await abrirDB_();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX_, 'readwrite');
    tx.objectStore(STORE_OUTBOX_).delete(clave);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function actualizarItemOutbox_(clave, cambios) {
  const db = await abrirDB_();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX_, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX_);
    const req = store.get(clave);
    req.onsuccess = () => {
      const item = req.result;
      if (item) { Object.assign(item, cambios); store.put(item); }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Cuando un Expediente TE1 encolado offline termina de sincronizarse y recibe su "codigo" real,
// hay que avisarle a cualquier documento que haya quedado en la cola apuntando a su clave local.
async function resolverDependientesTE1_(claveExpedienteLocal, codigoReal) {
  const pendientes = await listarOutbox_();
  for (const item of pendientes) {
    if (item.codigoLocalRef === claveExpedienteLocal) {
      const nuevaData = Object.assign({}, item.data, { codigo: codigoReal });
      await actualizarItemOutbox_(item.clave, { data: nuevaData, codigoLocalRef: null });
    }
  }
}

async function actualizarBadgeSync_() {
  const pendientes = await listarOutbox_().catch(() => []);
  const banner = document.getElementById('banner-sync');
  const texto = document.getElementById('banner-sync-texto');
  if (!banner || !texto) return;
  if (pendientes.length > 0) {
    texto.textContent = '🔄 ' + pendientes.length + ' pendiente(s) de enviar — toca para sincronizar';
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

let sincronizando_ = false;
async function intentarSincronizar_() {
  if (sincronizando_ || !navigator.onLine) return;
  sincronizando_ = true;
  try {
    const pendientes = await listarOutbox_();
    for (const item of pendientes) {
      if (item.codigoLocalRef) break; // dependencia (expediente) todavía sin sincronizar: cortar y reintentar después
      try {
        const resp = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ accion: item.accion, token: API_TOKEN, args: [item.data] }) });
        const resultado = await resp.json();
        if (resultado.ok) {
          if (item.accion === 'guardarExpedienteSEC' && resultado.codigo) {
            await resolverDependientesTE1_(item.clave, resultado.codigo);
          }
          await quitarDeOutbox_(item.clave);
        } else {
          console.error('No se pudo sincronizar un elemento pendiente:', resultado.error);
          break; // error de datos: no seguir insistiendo con los demás en este ciclo
        }
      } catch (e) {
        break; // se cortó la conexión a mitad de la sincronización
      }
    }
  } finally {
    sincronizando_ = false;
    actualizarBadgeSync_();
    refrescarDatosSiHayConexion_();
  }
}

// ---------- Llamadas de escritura (reemplaza a google.script.run) ----------
// Con conexión: POST al backend (texto plano, sin header Content-Type, para no disparar
// preflight CORS que Apps Script no responde). Sin conexión: las acciones de la lista de abajo
// se encolan en el outbox; cualquier otra acción exige conexión, nada se pierde si falla.
const ACCIONES_ENCOLABLES_OFFLINE_ = ['guardarInforme', 'guardarExpedienteSEC', 'subirDocumentoSEC'];

async function llamarApi(accion, args, opciones) {
  opciones = opciones || {};
  try {
    if (!navigator.onLine) throw new Error('offline');
    const resp = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ accion, token: API_TOKEN, args }) });
    if (!resp.ok) throw new Error('Error del servidor (' + resp.status + ')');
    const json = await resp.json();
    if (json && json.ok === false) throw new Error(json.error || 'Error desconocido');
    return json;
  } catch (err) {
    if (ACCIONES_ENCOLABLES_OFFLINE_.includes(accion)) return encolarOffline_(accion, args[0], opciones.codigoLocalRef);
    throw new Error('Esta acción requiere conexión a internet.');
  }
}

window.addEventListener('online', () => { mostrarBannerOffline_(false); intentarSincronizar_(); refrescarDatosSiHayConexion_(); });
window.addEventListener('offline', () => mostrarBannerOffline_(true));

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const bannerSync = document.getElementById('banner-sync');
  if (bannerSync) bannerSync.addEventListener('click', intentarSincronizar_);
  mostrarBannerOffline_(!navigator.onLine);
  actualizarBadgeSync_();
  refrescarDatosSiHayConexion_();
  intentarSincronizar_();
});
