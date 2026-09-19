// ==================== EXPEDIENTE TE1 ====================
// Captura en terreno (offline) del expediente de instalación eléctrica interior antes de
// declararla a la SEC: checklist según tipo de suministro, puntos propuestos, documentos y
// cuadro de cargas. Se guarda con llamarApi('guardarExpedienteTE1'/'subirDocumentoTE1', ...)
// de pwa-api.js, que ya sabe encolar offline y sincronizar solo — acá no se reimplementa nada
// de eso. El cierre ("Finalizar", con el diagrama unifilar) se hace desde la app de oficina,
// no desde acá.

let checklistTE1Base_ = null; // { "Monofásica": [...], "Trifásica": [...] }, cargado una vez
let normativaTE1_ = null; // { canalizaciones: [...], ampacidadCobrePVC: {...} }, ver normativa-te1.json
let expedienteActual_ = null; // { codigo, claveLocal, tipoSuministro, checklist, circuitos, ... }
let documentosPendientes_ = []; // [{categoria, nombreArchivo, base64}] agregados y aún no enviados
let contadorCircuitos_ = 0;

async function cargarChecklistTE1_() {
  if (checklistTE1Base_) return checklistTE1Base_;
  try {
    const resp = await fetch('checklist-te1.json');
    checklistTE1Base_ = await resp.json();
  } catch (e) {
    checklistTE1Base_ = { 'Monofásica': [], 'Trifásica': [] };
  }
  return checklistTE1Base_;
}

// Valores de referencia (editables en normativa-te1.json, ver "nota" ahí) para avisar posibles
// problemas de dimensionamiento — no reemplazan el criterio del técnico ni son un respaldo
// normativo certificado.
async function cargarNormativaTE1_() {
  if (normativaTE1_) return normativaTE1_;
  try {
    const resp = await fetch('normativa-te1.json');
    normativaTE1_ = await resp.json();
  } catch (e) {
    normativaTE1_ = { canalizaciones: [], ampacidadCobrePVC: {} };
  }
  return normativaTE1_;
}

function contenedorTE1_() {
  return document.getElementById('te1-contenedor');
}

// ---------- Borrador local (mismo patrón que el Informe de Visita: protege contra un refresh) ----------
function guardarBorradorTE1_() {
  if (!expedienteActual_) return;
  try { localStorage.setItem('borrador_te1', JSON.stringify(expedienteActual_)); } catch (e) { /* no es fatal */ }
}
function restaurarBorradorTE1_() {
  try {
    const crudo = localStorage.getItem('borrador_te1');
    return crudo ? JSON.parse(crudo) : null;
  } catch (e) { return null; }
}
function borrarBorradorTE1_() {
  try { localStorage.removeItem('borrador_te1'); } catch (e) { /* no es fatal */ }
}

// ---------- Pantalla principal de la pestaña: lista + botón "Nuevo expediente" ----------
function mostrarTE1_() {
  const cont = contenedorTE1_();
  const borrador = restaurarBorradorTE1_();
  cont.innerHTML = `
    <div class="seccion">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3 style="margin:0;">Expedientes SEC</h3>
        <button type="button" class="btn-enviar" id="btn-nuevo-te1" style="width:auto; padding:8px 16px;">+ Nuevo</button>
      </div>
      ${borrador ? `<p style="background:#fff3cd;color:#664d03;padding:10px 14px;border-radius:8px;font-size:13px;">
        Tienes un expediente SEC sin terminar de enviar (${borrador.codigo || 'sin código aún'} — ${borrador.cliente || 'sin cliente'}).
        <button type="button" id="btn-continuar-borrador-te1" style="margin-left:8px;">Continuar</button>
      </p>` : ''}
      <div id="te1-lista-sincronizados"></div>
    </div>
    <div id="te1-formulario"></div>
  `;
  document.getElementById('btn-nuevo-te1').addEventListener('click', () => nuevoExpedienteTE1_());
  const btnContinuarBorrador = document.getElementById('btn-continuar-borrador-te1');
  if (btnContinuarBorrador) btnContinuarBorrador.addEventListener('click', () => abrirExpedienteTE1_(borrador));
  refrescarListaExpedientesTE1_();
}

// Llamada por pwa-api.js cada vez que se refresca EXPEDIENTES_TE1 contra la API.
function refrescarListaExpedientesTE1_() {
  const cont = document.getElementById('te1-lista-sincronizados');
  if (!cont) return; // la pestaña TE1 no está abierta ahora mismo
  const lista = (typeof EXPEDIENTES_TE1 !== 'undefined' ? EXPEDIENTES_TE1 : []) || [];
  if (!lista.length) {
    cont.innerHTML = '<p style="color:#888;font-size:13px;">Sin expedientes sincronizados todavía.</p>';
    return;
  }
  cont.innerHTML = `
    <table class="tabla-registros">
      <thead><tr><th>Código</th><th>Cliente</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        ${lista.map(e => `
          <tr>
            <td>${e.Codigo}</td>
            <td>${e.Cliente || ''}</td>
            <td>${e.TipoSuministro || ''}</td>
            <td>${e.Estado || ''}</td>
            <td>${e.Estado !== 'Finalizado' ? `<button type="button" class="btn-fila btn-continuar-te1" data-codigo="${e.Codigo}">Continuar</button>` : ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  cont.querySelectorAll('.btn-continuar-te1').forEach(btn => {
    btn.addEventListener('click', () => {
      const expediente = lista.find(e => e.Codigo === btn.dataset.codigo);
      if (expediente) {
        abrirExpedienteTE1_({
          codigo: expediente.Codigo, fecha: expediente.Fecha, tecnico: expediente.Tecnico,
          cliente: expediente.Cliente, direccion: expediente.Direccion, telefono: expediente.Telefono,
          contacto: expediente.Contacto, correo: expediente.Correo, tipoSuministro: expediente.TipoSuministro,
          checklist: expediente.Checklist, puntosPropuestos: expediente.PuntosPropuestos,
          circuitos: expediente.Circuitos, factorDemanda: expediente.FactorDemanda || 1
        });
      }
    });
  });
}

async function nuevoExpedienteTE1_() {
  await Promise.all([cargarChecklistTE1_(), cargarNormativaTE1_()]);
  expedienteActual_ = {
    codigo: '', claveLocal: '', fecha: new Date().toISOString().slice(0, 10), tecnico: '',
    cliente: '', direccion: '', telefono: '', contacto: '', correo: '',
    tipoSuministro: '', checklist: [], puntosPropuestos: [], circuitos: [], factorDemanda: 1
  };
  documentosPendientes_ = [];
  renderFormularioTE1_();
}

async function abrirExpedienteTE1_(datos) {
  await Promise.all([cargarChecklistTE1_(), cargarNormativaTE1_()]);
  expedienteActual_ = Object.assign({
    codigo: '', claveLocal: '', fecha: '', tecnico: '', cliente: '', direccion: '', telefono: '',
    contacto: '', correo: '', tipoSuministro: '', checklist: [], puntosPropuestos: [], circuitos: [], factorDemanda: 1
  }, datos);
  documentosPendientes_ = [];
  renderFormularioTE1_();
}

// ---------- Cálculo de corriente y demanda (factor de potencia fijo en 1.0) ----------
function calcularCorrienteCircuito_(potenciaW, tension, tipoSuministro) {
  const p = Number(potenciaW) || 0;
  const v = Number(tension) || 0;
  if (!p || !v) return 0;
  const corriente = tipoSuministro === 'Trifásica' ? p / (v * Math.sqrt(3)) : p / v;
  return Math.round(corriente * 100) / 100;
}

function recalcularDemandaTotal_() {
  const filas = document.querySelectorAll('#tabla-circuitos-te1 tbody tr');
  let total = 0;
  filas.forEach(fila => { total += Number(fila.querySelector('.circuito-potencia').value) || 0; });
  const factor = Number(document.getElementById('te1-factor-demanda').value) || 1;
  const demandaTotal = Math.round(total * factor);
  document.getElementById('te1-demanda-total').textContent = demandaTotal + ' W';
  return demandaTotal;
}

// ---------- Render del formulario completo (una sola vez por expediente abierto) ----------
function renderFormularioTE1_() {
  const cont = document.getElementById('te1-formulario');
  const e = expedienteActual_;
  contadorCircuitos_ = 0;

  cont.innerHTML = `
    <div class="seccion">
      <h3 style="margin-top:0;">${e.codigo ? 'Expediente ' + e.codigo : 'Nuevo Expediente SEC'}</h3>
      <label>Fecha</label>
      <input type="date" id="te1-fecha" value="${e.fecha || ''}">
      <label>Técnico</label>
      <select id="te1-tecnico">
        <option value="" ${!e.tecnico ? 'selected' : ''} disabled>Selecciona un técnico</option>
        <option ${e.tecnico === 'Rodrigo Pizarro' ? 'selected' : ''}>Rodrigo Pizarro</option>
        <option ${e.tecnico === 'Edinson Castillo' ? 'selected' : ''}>Edinson Castillo</option>
        <option ${e.tecnico === 'Otro' ? 'selected' : ''}>Otro</option>
      </select>
      <label>Cliente</label>
      <input type="text" id="te1-cliente" value="${e.cliente || ''}">
      <label>Dirección</label>
      <input type="text" id="te1-direccion" value="${e.direccion || ''}">
      <div class="fila-doble">
        <div><label>Teléfono</label><input type="tel" id="te1-telefono" value="${e.telefono || ''}"></div>
        <div><label>Contacto</label><input type="text" id="te1-contacto" value="${e.contacto || ''}"></div>
      </div>
      <label>Correo</label>
      <input type="email" id="te1-correo" value="${e.correo || ''}">

      <label>Tipo de Suministro</label>
      <div class="tipo-servicio">
        <label><input type="radio" name="te1-tipo-suministro" value="Monofásica" ${e.tipoSuministro === 'Monofásica' ? 'checked' : ''}><span>Monofásica</span></label>
        <label><input type="radio" name="te1-tipo-suministro" value="Trifásica" ${e.tipoSuministro === 'Trifásica' ? 'checked' : ''}><span>Trifásica</span></label>
      </div>
    </div>

    <div class="seccion" id="te1-seccion-checklist" style="${e.tipoSuministro ? '' : 'display:none;'}">
      <h3 style="margin-top:0;">Checklist de Verificación</h3>
      <div id="te1-checklist-items"></div>
    </div>

    <div class="seccion">
      <h3 style="margin-top:0;">Puntos Propuestos</h3>
      <div id="te1-puntos-lista"></div>
      <button type="button" class="btn-fila" id="btn-agregar-punto-te1">+ Agregar punto propuesto</button>
    </div>

    <div class="seccion">
      <h3 style="margin-top:0;">Documentos</h3>
      <div class="fila-doble">
        <div>
          <label>Categoría</label>
          <select id="te1-doc-categoria">
            <option>Cédula Instalador</option>
            <option>Contrato de Suministro</option>
            <option>Foto Empalme</option>
            <option>Foto Tablero</option>
            <option>Plano</option>
            <option>Memoria Explicativa</option>
            <option>Otros</option>
          </select>
        </div>
        <div><label>Archivo</label><input type="file" id="te1-doc-archivo" accept="image/*,.pdf"></div>
      </div>
      <button type="button" class="btn-fila" id="btn-agregar-doc-te1" style="margin-top:8px;">+ Agregar documento</button>
      <div id="te1-docs-lista" style="margin-top:10px;"></div>
    </div>

    <div class="seccion">
      <h3 style="margin-top:0;">Cuadro de Cargas (Circuitos)</h3>
      <div style="overflow-x:auto;">
        <table class="tabla-registros" id="tabla-circuitos-te1">
          <thead><tr>
            <th></th><th>N°</th><th>Descripción</th><th>Potencia (W)</th><th>Tensión (V)</th><th>Corriente (A)</th>
            <th>Conductor (mm²)</th><th>Longitud (m)</th><th>Protección</th><th>Diferencial</th><th>Canalización</th><th></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <button type="button" class="btn-fila" id="btn-agregar-circuito-te1" style="margin-top:8px;">+ Agregar circuito</button>
      <div class="fila-doble" style="margin-top:12px;">
        <div><label>Factor de demanda</label><input type="number" step="0.05" min="0" id="te1-factor-demanda" value="${e.factorDemanda || 1}"></div>
        <div><label>Demanda Total</label><p id="te1-demanda-total" style="font-weight:600;font-size:16px;margin:8px 0;">0 W</p></div>
      </div>
      <div id="te1-avisos-normativa"></div>
      <p style="font-size:11px;color:#888;margin-top:6px;">Los avisos de corriente/protección usan la Tabla Nº 8.7 de la NCh Elec. 4/2003 (cobre/PVC, 30°C, sin corregir por temperatura ni agrupamiento de conductores — ver normativa-te1.json). No es un respaldo normativo certificado — revisar siempre con criterio profesional.</p>
    </div>

    <button type="button" class="btn-enviar" id="btn-guardar-te1">Guardar Expediente</button>
    <p id="te1-mensaje-estado" style="margin-top:10px;"></p>
  `;

  // ---- Datos generales: cada cambio actualiza el borrador local ----
  ['te1-fecha', 'te1-tecnico', 'te1-cliente', 'te1-direccion', 'te1-telefono', 'te1-contacto', 'te1-correo'].forEach(id => {
    document.getElementById(id).addEventListener('input', sincronizarEstadoDesdeFormularioTE1_);
  });
  document.querySelectorAll('input[name="te1-tipo-suministro"]').forEach(radio => {
    radio.addEventListener('change', () => {
      expedienteActual_.tipoSuministro = radio.value;
      expedienteActual_.checklist = (checklistTE1Base_[radio.value] || []).map(it => Object.assign({ estado: '', observacion: '' }, it));
      document.getElementById('te1-seccion-checklist').style.display = 'block';
      renderChecklistTE1_();
      guardarBorradorTE1_();
    });
  });

  document.getElementById('btn-agregar-punto-te1').addEventListener('click', () => agregarFilaPuntoTE1_());
  document.getElementById('btn-agregar-doc-te1').addEventListener('click', agregarDocumentoTE1_);
  document.getElementById('btn-agregar-circuito-te1').addEventListener('click', () => agregarFilaCircuitoTE1_());
  document.getElementById('te1-factor-demanda').addEventListener('input', () => { recalcularDemandaTotal_(); guardarBorradorTE1_(); });
  document.getElementById('btn-guardar-te1').addEventListener('click', guardarExpedienteTE1_);

  if (e.tipoSuministro) renderChecklistTE1_();
  (e.puntosPropuestos || []).forEach(p => agregarFilaPuntoTE1_(p));
  (e.circuitos || []).forEach(c => agregarFilaCircuitoTE1_(c));
  recalcularDemandaTotal_();
}

function sincronizarEstadoDesdeFormularioTE1_() {
  const e = expedienteActual_;
  e.fecha = document.getElementById('te1-fecha').value;
  e.tecnico = document.getElementById('te1-tecnico').value;
  e.cliente = document.getElementById('te1-cliente').value;
  e.direccion = document.getElementById('te1-direccion').value;
  e.telefono = document.getElementById('te1-telefono').value;
  e.contacto = document.getElementById('te1-contacto').value;
  e.correo = document.getElementById('te1-correo').value;
  guardarBorradorTE1_();
}

// ---------- Checklist dinámico según tipo de suministro ----------
function renderChecklistTE1_() {
  const cont = document.getElementById('te1-checklist-items');
  const categorias = {};
  expedienteActual_.checklist.forEach((it, idx) => {
    (categorias[it.categoria] = categorias[it.categoria] || []).push(Object.assign({ idx }, it));
  });
  cont.innerHTML = Object.keys(categorias).map(cat => `
    <h4 style="margin:14px 0 6px;color:var(--azul-oscuro);">${cat}</h4>
    ${categorias[cat].map(it => `
      <div class="te1-checklist-fila" data-idx="${it.idx}" style="border-bottom:1px solid var(--borde);padding:8px 0;${it.duda ? 'border-left:3px solid #ff7a1a;padding-left:8px;' : ''}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <span style="flex:1;font-size:14px;">${it.item}${it.obligatorio ? ' <span style="color:#c0392b;">*</span>' : ''}</span>
          <select class="te1-checklist-estado" data-idx="${it.idx}" style="width:auto;">
            <option value="" ${!it.estado ? 'selected' : ''}>Sin contestar</option>
            <option value="Cumple" ${it.estado === 'Cumple' ? 'selected' : ''}>Cumple</option>
            <option value="No cumple" ${it.estado === 'No cumple' ? 'selected' : ''}>No cumple</option>
            <option value="No aplica" ${it.estado === 'No aplica' ? 'selected' : ''}>No aplica</option>
          </select>
        </div>
        <input type="text" class="te1-checklist-obs" data-idx="${it.idx}" placeholder="Observación (opcional)" value="${it.observacion || ''}" style="margin-top:4px;">
        <input type="text" class="te1-checklist-duda" data-idx="${it.idx}" placeholder="¿Alguna duda con este ítem? Escribe la consulta para revisarla después" value="${it.duda || ''}" style="margin-top:4px;${it.duda ? 'border-color:#ff7a1a;' : ''}">
      </div>
    `).join('')}
  `).join('');

  cont.querySelectorAll('.te1-checklist-estado').forEach(sel => {
    sel.addEventListener('change', () => {
      expedienteActual_.checklist[Number(sel.dataset.idx)].estado = sel.value;
      guardarBorradorTE1_();
    });
  });
  cont.querySelectorAll('.te1-checklist-obs').forEach(inp => {
    inp.addEventListener('input', () => {
      expedienteActual_.checklist[Number(inp.dataset.idx)].observacion = inp.value;
      guardarBorradorTE1_();
    });
  });
  // "Duda / a consultar": queda guardada junto al ítem y resaltada, para que la oficina la vea
  // reunida al revisar el expediente (ver "Dudas a consultar" en abrirDetalleTE1Oficina_, Index.html).
  cont.querySelectorAll('.te1-checklist-duda').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = Number(inp.dataset.idx);
      expedienteActual_.checklist[idx].duda = inp.value;
      inp.closest('.te1-checklist-fila').style.cssText = inp.value
        ? 'border-bottom:1px solid var(--borde);padding:8px 0;border-left:3px solid #ff7a1a;padding-left:8px;'
        : 'border-bottom:1px solid var(--borde);padding:8px 0;';
      inp.style.borderColor = inp.value ? '#ff7a1a' : '';
      guardarBorradorTE1_();
    });
  });
}

// ---------- Puntos propuestos ----------
function agregarFilaPuntoTE1_(datosIniciales) {
  const cont = document.getElementById('te1-puntos-lista');
  const fila = document.createElement('div');
  fila.className = 'fila-doble';
  fila.style.cssText = 'margin-bottom:8px;align-items:flex-end;';
  fila.innerHTML = `
    <div style="flex:2;"><input type="text" class="punto-texto" placeholder="Descripción" value="${datosIniciales ? (datosIniciales.texto || '') : ''}"></div>
    <div>
      <select class="punto-prioridad">
        <option ${datosIniciales && datosIniciales.prioridad === 'Alta' ? 'selected' : ''}>Alta</option>
        <option ${!datosIniciales || datosIniciales.prioridad === 'Media' ? 'selected' : ''}>Media</option>
        <option ${datosIniciales && datosIniciales.prioridad === 'Baja' ? 'selected' : ''}>Baja</option>
      </select>
    </div>
    <button type="button" class="btn-fila btn-eliminar-fila">×</button>
  `;
  fila.querySelector('.btn-eliminar-fila').addEventListener('click', () => fila.remove());
  fila.querySelectorAll('input, select').forEach(el => el.addEventListener('input', guardarBorradorTE1_));
  cont.appendChild(fila);
}

function leerPuntosPropuestosTE1_() {
  return Array.from(document.querySelectorAll('#te1-puntos-lista > div')).map(fila => ({
    texto: fila.querySelector('.punto-texto').value,
    prioridad: fila.querySelector('.punto-prioridad').value,
    estado: 'Pendiente'
  })).filter(p => p.texto);
}

// ---------- Documentos (se leen a base64 y se suben recién al Guardar) ----------
function agregarDocumentoTE1_() {
  const categoria = document.getElementById('te1-doc-categoria').value;
  const input = document.getElementById('te1-doc-archivo');
  const archivo = input.files[0];
  if (!archivo) return;
  const reader = new FileReader();
  reader.onload = ev => {
    documentosPendientes_.push({ categoria, nombreArchivo: archivo.name, base64: ev.target.result });
    input.value = '';
    renderDocumentosPendientesTE1_();
  };
  reader.readAsDataURL(archivo);
}

function renderDocumentosPendientesTE1_() {
  const cont = document.getElementById('te1-docs-lista');
  cont.innerHTML = documentosPendientes_.map((d, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--borde);font-size:13px;">
      <span><strong>${d.categoria}</strong> — ${d.nombreArchivo}</span>
      <button type="button" class="btn-fila btn-eliminar-fila" data-i="${i}">×</button>
    </div>
  `).join('');
  cont.querySelectorAll('.btn-eliminar-fila').forEach(btn => {
    btn.addEventListener('click', () => { documentosPendientes_.splice(Number(btn.dataset.i), 1); renderDocumentosPendientesTE1_(); });
  });
}

// ---------- Circuitos (cuadro de cargas) ----------
function agregarFilaCircuitoTE1_(datosIniciales) {
  contadorCircuitos_++;
  const tbody = document.querySelector('#tabla-circuitos-te1 tbody');
  const fila = document.createElement('tr');
  const d = datosIniciales || {};
  const opcionesCanalizacion = (normativaTE1_ && normativaTE1_.canalizaciones || [])
    .map(c => `<option value="${c}" ${d.canalizacion === c ? 'selected' : ''}>${c}</option>`).join('');
  fila.innerHTML = `
    <td class="circuito-estado" style="text-align:center;" title="">✅</td>
    <td><input type="number" class="circuito-numero" value="${d.numero || contadorCircuitos_}" style="width:50px;"></td>
    <td><input type="text" class="circuito-descripcion" value="${d.descripcion || ''}" style="width:120px;"></td>
    <td><input type="number" class="circuito-potencia" value="${d.potenciaW || ''}" style="width:80px;"></td>
    <td><input type="number" class="circuito-tension" value="${d.tension || 220}" style="width:70px;"></td>
    <td class="circuito-corriente" style="text-align:right;">0</td>
    <td><input type="text" class="circuito-seccion" value="${d.seccionMm2 || ''}" style="width:60px;" placeholder="mm²"></td>
    <td><input type="number" class="circuito-longitud" value="${d.longitud || ''}" style="width:60px;"></td>
    <td><input type="text" class="circuito-proteccion" value="${d.proteccion || ''}" style="width:70px;" placeholder="A"></td>
    <td><input type="text" class="circuito-diferencial" value="${d.diferencial || ''}" style="width:70px;"></td>
    <td><select class="circuito-canalizacion" style="width:150px;"><option value="">Selecciona...</option>${opcionesCanalizacion}</select></td>
    <td><button type="button" class="btn-fila btn-eliminar-fila">×</button></td>
  `;
  const recalcularFila = () => {
    const potencia = fila.querySelector('.circuito-potencia').value;
    const tension = fila.querySelector('.circuito-tension').value;
    fila.querySelector('.circuito-corriente').textContent = calcularCorrienteCircuito_(potencia, tension, expedienteActual_.tipoSuministro);
    recalcularDemandaTotal_();
    revalidarCircuitosTE1_();
    guardarBorradorTE1_();
  };
  fila.querySelectorAll('input, select').forEach(el => el.addEventListener('input', recalcularFila));
  fila.querySelector('.btn-eliminar-fila').addEventListener('click', () => { fila.remove(); recalcularDemandaTotal_(); revalidarCircuitosTE1_(); guardarBorradorTE1_(); });
  tbody.appendChild(fila);
  recalcularFila();
}

function leerCircuitosTE1_() {
  return Array.from(document.querySelectorAll('#tabla-circuitos-te1 tbody tr')).map(fila => ({
    numero: fila.querySelector('.circuito-numero').value,
    descripcion: fila.querySelector('.circuito-descripcion').value,
    potenciaW: fila.querySelector('.circuito-potencia').value,
    tension: fila.querySelector('.circuito-tension').value,
    corrienteCalculada: fila.querySelector('.circuito-corriente').textContent,
    seccionMm2: fila.querySelector('.circuito-seccion').value,
    longitud: fila.querySelector('.circuito-longitud').value,
    proteccion: fila.querySelector('.circuito-proteccion').value,
    diferencial: fila.querySelector('.circuito-diferencial').value,
    canalizacion: fila.querySelector('.circuito-canalizacion').value
  })).filter(c => c.descripcion || c.potenciaW);
}

// ---------- Validación orientativa contra la tabla de ampacidad (ver normativa-te1.json) ----------
// Busca la corriente admisible en la Tabla Nº 8.7 de la NCh Elec. 4/2003, según sección y el
// "grupo" (método de instalación) que corresponde a la canalización elegida en la fila.
function buscarAmpacidad_(seccionTexto, canalizacion) {
  const tabla = (normativaTE1_ && normativaTE1_.corrienteAdmisibleTabla87) || {};
  const grupoPorCanalizacion = (normativaTE1_ && normativaTE1_.grupoPorCanalizacion) || {};
  const seccion = parseFloat(String(seccionTexto || '').replace(',', '.'));
  const grupo = grupoPorCanalizacion[canalizacion];
  if (!seccion || !grupo) return null;

  const leerFila = clave => (tabla[clave] ? tabla[clave][grupo] : undefined);
  const claveExacta = Object.keys(tabla).find(k => parseFloat(k) === seccion);
  if (claveExacta && leerFila(claveExacta) != null) return leerFila(claveExacta);
  // Sin match exacto (o esa sección no está definida en esa columna): usa la más cercana hacia arriba.
  const secciones = Object.keys(tabla).map(parseFloat).sort((a, b) => a - b);
  const masCercana = secciones.find(s => s >= seccion && leerFila(String(s)) != null);
  return masCercana != null ? leerFila(String(masCercana)) : null;
}

function validarCircuitoTE1_(fila) {
  const avisos = [];
  const corriente = parseFloat(fila.querySelector('.circuito-corriente').textContent) || 0;
  const seccionTexto = fila.querySelector('.circuito-seccion').value;
  const canalizacion = fila.querySelector('.circuito-canalizacion').value;
  const proteccion = parseFloat(String(fila.querySelector('.circuito-proteccion').value || '').replace(',', '.'));
  const diferencial = fila.querySelector('.circuito-diferencial').value.trim();
  const numero = fila.querySelector('.circuito-numero').value;
  const ampacidad = buscarAmpacidad_(seccionTexto, canalizacion);

  if (ampacidad && corriente > ampacidad) {
    avisos.push(`Circuito ${numero}: la corriente calculada (${corriente}A) supera la corriente admisible de la Tabla 8.7 para ${seccionTexto}mm² en "${canalizacion}" (${ampacidad}A). Sugerencia: usar una sección mayor.`);
  }
  if (ampacidad && proteccion && proteccion > ampacidad) {
    avisos.push(`Circuito ${numero}: la protección (${proteccion}A) supera la corriente admisible del conductor (${ampacidad}A, Tabla 8.7). Sugerencia: bajar la protección o subir la sección.`);
  }
  if (proteccion && corriente && proteccion < corriente) {
    avisos.push(`Circuito ${numero}: la protección (${proteccion}A) es menor que la corriente calculada (${corriente}A). Revisar dimensionamiento.`);
  }
  if (!diferencial || /^no$/i.test(diferencial)) {
    avisos.push(`Circuito ${numero}: sin diferencial asignado — revisar protección contra contactos indirectos (NCh Elec. 4/2003, sección 9.2). En la práctica se usa 30mA para circuitos generales y sensibilidades menores (10mA o 5mA) en recintos húmedos/mojados o piscinas (sección 11.4).`);
  }
  return avisos;
}

function revalidarCircuitosTE1_() {
  const panel = document.getElementById('te1-avisos-normativa');
  if (!panel) return; // el cuadro de cargas todavía no se renderizó
  const filas = document.querySelectorAll('#tabla-circuitos-te1 tbody tr');
  let todosLosAvisos = [];
  filas.forEach(fila => {
    const avisos = validarCircuitoTE1_(fila);
    fila.querySelector('.circuito-estado').textContent = avisos.length ? '⚠️' : '✅';
    fila.querySelector('.circuito-estado').title = avisos.join('\n');
    todosLosAvisos = todosLosAvisos.concat(avisos);
  });
  panel.innerHTML = todosLosAvisos.length
    ? `<div style="background:#fff3cd;color:#664d03;padding:10px 14px;border-radius:8px;font-size:13px;margin-top:10px;">
        <strong>A revisar:</strong>
        <ul style="margin:6px 0 0;padding-left:18px;">${todosLosAvisos.map(a => `<li>${a}</li>`).join('')}</ul>
      </div>`
    : '';
}

// ---------- Guardar (online: sube directo / offline: encola — ver llamarApi en pwa-api.js) ----------
async function guardarExpedienteTE1_() {
  const boton = document.getElementById('btn-guardar-te1');
  const mensaje = document.getElementById('te1-mensaje-estado');
  if (!expedienteActual_.tipoSuministro) {
    mensaje.textContent = 'Selecciona el tipo de suministro antes de guardar.';
    mensaje.style.color = '#c0392b';
    return;
  }
  sincronizarEstadoDesdeFormularioTE1_();
  boton.disabled = true;
  mensaje.textContent = 'Guardando...';
  mensaje.style.color = '#666';

  const data = {
    codigo: expedienteActual_.codigo || '',
    fecha: expedienteActual_.fecha, tecnico: expedienteActual_.tecnico, cliente: expedienteActual_.cliente,
    direccion: expedienteActual_.direccion, telefono: expedienteActual_.telefono, contacto: expedienteActual_.contacto,
    correo: expedienteActual_.correo, tipoSuministro: expedienteActual_.tipoSuministro,
    checklist: expedienteActual_.checklist, puntosPropuestos: leerPuntosPropuestosTE1_(), circuitos: leerCircuitosTE1_(),
    factorDemanda: Number(document.getElementById('te1-factor-demanda').value) || 1,
    demandaTotalW: recalcularDemandaTotal_()
  };

  try {
    const resp = await llamarApi('guardarExpedienteTE1', [data]);
    if (!resp.ok) throw new Error(resp.error || 'Error desconocido');

    if (resp.pendienteSync) {
      expedienteActual_.claveLocal = resp.clave;
      mensaje.textContent = 'Guardado en el celular. Se enviará solo cuando haya conexión (' + documentosPendientes_.length + ' documento(s) en cola).';
      mensaje.style.color = '#664d03';
    } else {
      expedienteActual_.codigo = resp.codigo;
      mensaje.textContent = 'Expediente ' + resp.codigo + ' guardado correctamente.';
      mensaje.style.color = '#34a853';
      borrarBorradorTE1_();
    }

    // Subir los documentos agregados en esta sesión, referenciando el código real (online)
    // o la clave local del expediente (offline, hasta que el expediente mismo se sincronice).
    const refDependencia = resp.pendienteSync ? { codigoLocalRef: expedienteActual_.claveLocal } : {};
    for (const doc of documentosPendientes_) {
      await llamarApi('subirDocumentoTE1', [{ codigo: resp.pendienteSync ? '' : expedienteActual_.codigo, categoria: doc.categoria, nombreArchivo: doc.nombreArchivo, base64: doc.base64 }], refDependencia);
    }
    documentosPendientes_ = [];
    renderDocumentosPendientesTE1_();
    guardarBorradorTE1_();
  } catch (err) {
    mensaje.textContent = 'Error: ' + err.message;
    mensaje.style.color = '#c0392b';
  } finally {
    boton.disabled = false;
  }
}
