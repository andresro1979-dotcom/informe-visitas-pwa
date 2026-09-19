// ==================== EXPEDIENTE SEC ====================
// Captura en terreno (offline) de declaraciones ante la SEC: TE1 (instalación eléctrica
// interior), TE2 (puesta en servicio de alumbrado público). TE3 queda como "Próximamente"
// en el selector hasta que se construya. Se guarda con llamarApi('guardarExpedienteSEC'/
// 'subirDocumentoSEC', ...) de pwa-api.js, que ya sabe encolar offline y sincronizar solo —
// acá no se reimplementa nada de eso. El cierre ("Finalizar") se hace desde la oficina.
//
// Campos de TE2 basados en el "Manual de Usuario Plataforma Trámite TE2" (e-Declarador,
// SEC, marzo 2020): Paso 4 (Proyecto), Paso 6 (Luminarias) y Paso 7 (Adjuntos). No replica
// el trámite completo (ej. datos del Declarador, que son fijos del instalador, no del
// expediente) — es una checklist de captura en terreno, la presentación real en e-Declarador
// la hace la oficina aparte con estos datos como respaldo.

let checklistTE1Base_ = null; // { "Monofásica": [...], "Trifásica": [...] }
let checklistTE2Base_ = null; // [...] (un solo checklist, no depende de un sub-tipo)
let normativaTE1_ = null; // { canalizaciones: [...], corrienteAdmisibleTabla87: {...}, ... }
let expedienteActual_ = null;
let documentosPendientes_ = []; // [{categoria, nombreArchivo, base64}] agregados y aún no enviados
let contadorCircuitos_ = 0;
let contadorPostacion_ = 0;
let contadorLuminarias_ = 0;

const CATEGORIAS_DOC_TE1_ =['Cédula Instalador', 'Contrato de Suministro', 'Foto Empalme', 'Foto Tablero', 'Plano', 'Memoria Explicativa', 'Otros'];
const CATEGORIAS_DOC_TE2_ = ['Detalle de Instalaciones (marca/modelo lámpara)', 'Plano del Proyecto (DWG)', 'Permiso Municipal de Edificación', 'Memoria Explicativa', 'Memoria de Cálculo de Puesta a Tierra', 'Memoria de Cálculo de Alumbrado Público (Vías)', 'Otros'];

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

async function cargarChecklistTE2_() {
  if (checklistTE2Base_) return checklistTE2Base_;
  try {
    const resp = await fetch('checklist-te2.json');
    checklistTE2Base_ = await resp.json();
  } catch (e) {
    checklistTE2Base_ = [];
  }
  return checklistTE2Base_;
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
    normativaTE1_ = { canalizaciones: [], corrienteAdmisibleTabla87: {}, grupoPorCanalizacion: {} };
  }
  return normativaTE1_;
}

async function cargarTodoElContenidoSEC_() {
  await Promise.all([cargarChecklistTE1_(), cargarChecklistTE2_(), cargarNormativaTE1_()]);
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

function expedienteVacio_() {
  return {
    codigo: '', claveLocal: '', tipoTramite: '', fecha: new Date().toISOString().slice(0, 10), tecnico: '',
    cliente: '', direccion: '', telefono: '', contacto: '', correo: '',
    tipoSuministro: '', checklist: [], puntosPropuestos: [], circuitos: [], factorDemanda: 1,
    datosProyecto: { postacion: [], encargadoMunicipal: {} }, luminarias: []
  };
}

// ---------- Pantalla principal de la pestaña: lista + botón "Nuevo expediente" ----------
function mostrarTE1_() {
  const cont = contenedorTE1_();
  // Si ya hay un expediente abierto en pantalla (ej. el técnico fue un momento a la pestaña
  // Cuaderno NCh a consultar algo), no se rehace la vista: se conserva lo que ya llenó.
  const formAbierto = document.getElementById('te1-formulario');
  if (formAbierto && formAbierto.children.length) return;
  const borrador = restaurarBorradorTE1_();
  cont.innerHTML = `
    <div class="seccion">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3 style="margin:0;">Expedientes SEC</h3>
        <button type="button" class="btn-enviar" id="btn-nuevo-te1" style="width:auto; padding:8px 16px;">+ Nuevo</button>
      </div>
      ${borrador ? `<p style="background:#fff3cd;color:#664d03;padding:10px 14px;border-radius:8px;font-size:13px;">
        Tienes un expediente ${borrador.tipoTramite || 'SEC'} sin terminar de enviar (${borrador.codigo || 'sin código aún'} — ${borrador.cliente || 'sin cliente'}).
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
  if (!cont) return; // la pestaña Expediente SEC no está abierta ahora mismo
  const lista = (typeof EXPEDIENTES_TE1 !== 'undefined' ? EXPEDIENTES_TE1 : []) || [];
  if (!lista.length) {
    cont.innerHTML = '<p style="color:#888;font-size:13px;">Sin expedientes sincronizados todavía.</p>';
    return;
  }
  cont.innerHTML = `
    <table class="tabla-registros">
      <thead><tr><th>Código</th><th>Tipo</th><th>Cliente</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        ${lista.map(e => `
          <tr>
            <td>${e.Codigo}</td>
            <td>${e.TipoTramite || ''}</td>
            <td>${e.Cliente || ''}</td>
            <td>${e.Estado || ''}</td>
            <td>${e.Estado !== 'Finalizado' ? `<button type="button" class="btn-fila btn-continuar-te1" data-codigo="${e.Codigo}">Continuar</button> <button type="button" class="btn-fila btn-eliminar-fila btn-eliminar-te1" data-codigo="${e.Codigo}">Eliminar</button>` : ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  cont.querySelectorAll('.btn-eliminar-te1').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar el expediente ' + btn.dataset.codigo + '? Se borra de la hoja y sus documentos subidos van a la papelera. No se puede deshacer.')) return;
      btn.disabled = true;
      try {
        const resp = await llamarApi('eliminarExpedienteSEC', [btn.dataset.codigo]);
        if (!resp.ok) throw new Error(resp.error || 'Error desconocido');
        EXPEDIENTES_TE1 = EXPEDIENTES_TE1.filter(e => e.Codigo !== btn.dataset.codigo);
        guardarCache_('expedientesTE1', EXPEDIENTES_TE1);
        refrescarListaExpedientesTE1_();
      } catch (err) {
        btn.disabled = false;
        alert('No se pudo eliminar: ' + err.message);
      }
    });
  });
  cont.querySelectorAll('.btn-continuar-te1').forEach(btn => {
    btn.addEventListener('click', () => {
      const expediente = lista.find(e => e.Codigo === btn.dataset.codigo);
      if (expediente) {
        abrirExpedienteTE1_({
          codigo: expediente.Codigo, tipoTramite: expediente.TipoTramite, fecha: expediente.Fecha, tecnico: expediente.Tecnico,
          cliente: expediente.Cliente, direccion: expediente.Direccion, telefono: expediente.Telefono,
          contacto: expediente.Contacto, correo: expediente.Correo, tipoSuministro: expediente.TipoSuministro,
          checklist: expediente.Checklist, puntosPropuestos: expediente.PuntosPropuestos,
          circuitos: expediente.Circuitos, factorDemanda: expediente.FactorDemanda || 1,
          datosProyecto: expediente.DatosProyecto || { postacion: [], encargadoMunicipal: {} },
          luminarias: expediente.Luminarias || []
        });
      }
    });
  });
}

async function nuevoExpedienteTE1_() {
  await cargarTodoElContenidoSEC_();
  expedienteActual_ = expedienteVacio_();
  documentosPendientes_ = [];
  renderFormularioTE1_();
}

async function abrirExpedienteTE1_(datos) {
  await cargarTodoElContenidoSEC_();
  expedienteActual_ = Object.assign(expedienteVacio_(), datos);
  documentosPendientes_ = [];
  renderFormularioTE1_();
}

// ---------- Cálculo de corriente y demanda (factor de potencia fijo en 1.0) — solo TE1 ----------
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
  contadorPostacion_ = 0;
  contadorLuminarias_ = 0;

  cont.innerHTML = `
    <div class="seccion">
      <h3 style="margin-top:0;">${e.codigo ? 'Expediente ' + e.codigo : 'Nuevo Expediente SEC'}</h3>

      <label>Tipo de Trámite</label>
      <select id="sec-tipo-tramite" ${e.codigo ? 'disabled' : ''}>
        <option value="" ${!e.tipoTramite ? 'selected' : ''} disabled>Selecciona el tipo de trámite</option>
        <option value="TE1" ${e.tipoTramite === 'TE1' ? 'selected' : ''}>TE1 — Instalación eléctrica interior</option>
        <option value="TE2" ${e.tipoTramite === 'TE2' ? 'selected' : ''}>TE2 — Puesta en servicio de alumbrado público</option>
        <option value="TE3" disabled>TE3 — Próximamente</option>
      </select>
      ${e.codigo ? '' : '<p style="font-size:12px;color:#888;margin:4px 0 0;">El tipo de trámite no se puede cambiar después de guardar.</p>'}

      <div id="sec-resto-formulario" style="${e.tipoTramite ? '' : 'display:none;'}">
        <label>Fecha</label>
        <input type="date" id="te1-fecha" value="${e.fecha || ''}">
        <label>Técnico</label>
        <select id="te1-tecnico">
          <option value="" ${!e.tecnico ? 'selected' : ''} disabled>Selecciona un técnico</option>
          <option ${e.tecnico === 'Rodrigo Pizarro' ? 'selected' : ''}>Rodrigo Pizarro</option>
          <option ${e.tecnico === 'Edinson Castillo' ? 'selected' : ''}>Edinson Castillo</option>
          <option ${e.tecnico === 'Otro' ? 'selected' : ''}>Otro</option>
        </select>
        <label id="sec-label-cliente">Cliente</label>
        <input type="text" id="te1-cliente" value="${e.cliente || ''}">
        <label>Dirección</label>
        <input type="text" id="te1-direccion" value="${e.direccion || ''}">
        <div class="fila-doble">
          <div><label>Teléfono</label><input type="tel" id="te1-telefono" value="${e.telefono || ''}"></div>
          <div><label>Contacto</label><input type="text" id="te1-contacto" value="${e.contacto || ''}"></div>
        </div>
        <label>Correo</label>
        <input type="email" id="te1-correo" value="${e.correo || ''}">
      </div>
    </div>

    <div id="sec-cuerpo-tramite"></div>

    <div class="seccion" id="sec-seccion-puntos" style="${e.tipoTramite ? '' : 'display:none;'}">
      <h3 style="margin-top:0;">Puntos Propuestos</h3>
      <div id="te1-puntos-lista"></div>
      <button type="button" class="btn-fila" id="btn-agregar-punto-te1">+ Agregar punto propuesto</button>
    </div>

    <div class="seccion" id="sec-seccion-documentos" style="${e.tipoTramite ? '' : 'display:none;'}">
      <h3 style="margin-top:0;">Documentos</h3>
      <div class="fila-doble">
        <div>
          <label>Categoría</label>
          <select id="te1-doc-categoria"></select>
        </div>
        <div><label>Archivo</label><input type="file" id="te1-doc-archivo" accept="image/*,.pdf,.dwg"></div>
      </div>
      <button type="button" class="btn-fila" id="btn-agregar-doc-te1" style="margin-top:8px;">+ Agregar documento</button>
      <div id="te1-docs-lista" style="margin-top:10px;"></div>
    </div>

    <button type="button" class="btn-enviar" id="btn-guardar-te1" style="${e.tipoTramite ? '' : 'display:none;'}">Guardar Expediente</button>
    <p id="te1-mensaje-estado" style="margin-top:10px;"></p>
  `;

  document.getElementById('sec-tipo-tramite').addEventListener('change', ev => {
    expedienteActual_.tipoTramite = ev.target.value;
    document.getElementById('sec-resto-formulario').style.display = 'block';
    document.getElementById('sec-seccion-puntos').style.display = 'block';
    document.getElementById('sec-seccion-documentos').style.display = 'block';
    document.getElementById('btn-guardar-te1').style.display = '';
    document.getElementById('sec-label-cliente').textContent = expedienteActual_.tipoTramite === 'TE2' ? 'Propietario' : 'Cliente';
    poblarCategoriasDocumentoSEC_();
    renderCuerpoTramite_();
    guardarBorradorTE1_();
  });

  // ---- Datos generales: cada cambio actualiza el borrador local ----
  ['te1-fecha', 'te1-tecnico', 'te1-cliente', 'te1-direccion', 'te1-telefono', 'te1-contacto', 'te1-correo'].forEach(id => {
    document.getElementById(id).addEventListener('input', sincronizarEstadoDesdeFormularioTE1_);
  });

  document.getElementById('btn-agregar-punto-te1').addEventListener('click', () => agregarFilaPuntoTE1_());
  document.getElementById('btn-agregar-doc-te1').addEventListener('click', agregarDocumentoTE1_);
  document.getElementById('btn-guardar-te1').addEventListener('click', guardarExpedienteTE1_);

  if (e.tipoTramite) {
    document.getElementById('sec-label-cliente').textContent = e.tipoTramite === 'TE2' ? 'Propietario' : 'Cliente';
    poblarCategoriasDocumentoSEC_();
    renderCuerpoTramite_();
  }
  (e.puntosPropuestos || []).forEach(p => agregarFilaPuntoTE1_(p));
}

function poblarCategoriasDocumentoSEC_() {
  const sel = document.getElementById('te1-doc-categoria');
  const categorias = expedienteActual_.tipoTramite === 'TE2' ? CATEGORIAS_DOC_TE2_ : CATEGORIAS_DOC_TE1_;
  sel.innerHTML = categorias.map(c => `<option>${c}</option>`).join('');
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

// ---------- Cuerpo específico por tipo de trámite ----------
function renderCuerpoTramite_() {
  if (expedienteActual_.tipoTramite === 'TE2') renderCuerpoTE2_();
  else renderCuerpoTE1_();
}

function renderCuerpoTE1_() {
  const cont = document.getElementById('sec-cuerpo-tramite');
  const e = expedienteActual_;
  cont.innerHTML = `
    <div class="seccion">
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
  `;

  document.querySelectorAll('input[name="te1-tipo-suministro"]').forEach(radio => {
    radio.addEventListener('change', () => {
      expedienteActual_.tipoSuministro = radio.value;
      expedienteActual_.checklist = (checklistTE1Base_[radio.value] || []).map(it => Object.assign({ estado: '', observacion: '' }, it));
      document.getElementById('te1-seccion-checklist').style.display = 'block';
      renderChecklistTE1_();
      guardarBorradorTE1_();
    });
  });

  document.getElementById('btn-agregar-circuito-te1').addEventListener('click', () => agregarFilaCircuitoTE1_());
  document.getElementById('te1-factor-demanda').addEventListener('input', () => { recalcularDemandaTotal_(); guardarBorradorTE1_(); });

  if (e.tipoSuministro) renderChecklistTE1_();
  (e.circuitos || []).forEach(c => agregarFilaCircuitoTE1_(c));
  recalcularDemandaTotal_();
}

function renderCuerpoTE2_() {
  const cont = document.getElementById('sec-cuerpo-tramite');
  const e = expedienteActual_;
  const dp = e.datosProyecto || { postacion: [], encargadoMunicipal: {} };

  cont.innerHTML = `
    <div class="seccion">
      <h3 style="margin-top:0;">Datos del Proyecto</h3>
      <label>Nombre del Proyecto</label>
      <input type="text" id="te2-nombre-proyecto" value="${dp.nombreProyecto || ''}">
      <div class="fila-doble">
        <div><label>Cantidad de Planos</label><input type="number" min="0" id="te2-cantidad-planos" value="${dp.cantidadPlanos || ''}"></div>
        <div><label>Fecha de Puesta en Servicio</label><input type="date" id="te2-fecha-pes" value="${dp.fechaPuestaEnServicio || ''}"></div>
      </div>
      <label>Ubicación / Referencias</label>
      <input type="text" id="te2-ubicacion-ref" value="${dp.ubicacionReferencias || ''}" placeholder="Calles, pasajes, coordenadas u otra referencia">

      <label>Tipo de Declaración</label>
      <select id="te2-tipo-declaracion">
        <option value="" ${!dp.tipoDeclaracion ? 'selected' : ''} disabled>Selecciona...</option>
        <option ${dp.tipoDeclaracion === 'Nuevas instalaciones de alumbrado público' ? 'selected' : ''}>Nuevas instalaciones de alumbrado público</option>
        <option ${dp.tipoDeclaracion === 'Ampliación de alumbrado público — luminarias' ? 'selected' : ''}>Ampliación de alumbrado público — luminarias</option>
        <option ${dp.tipoDeclaracion === 'Recambio de alumbrado público — luminarias' ? 'selected' : ''}>Recambio de alumbrado público — luminarias</option>
        <option ${dp.tipoDeclaracion === 'Recambio de alumbrado público — lámparas' ? 'selected' : ''}>Recambio de alumbrado público — lámparas</option>
      </select>

      <label>Ejecutada Según Norma</label>
      <select id="te2-norma-ejecutada">
        <option value="" ${!dp.normaEjecutada ? 'selected' : ''} disabled>Selecciona...</option>
        <option ${dp.normaEjecutada === 'DS 2/2014 (Vías de Tránsito Vehicular)' ? 'selected' : ''}>DS 2/2014 (Vías de Tránsito Vehicular)</option>
        <option ${dp.normaEjecutada === 'DS 51/2015 (Tránsito Peatonal)' ? 'selected' : ''}>DS 51/2015 (Tránsito Peatonal)</option>
        <option ${dp.normaEjecutada === 'Otra' ? 'selected' : ''}>Otra</option>
      </select>

      <div class="fila-doble">
        <div><label>Longitud Red Aérea (km)</label><input type="number" step="0.01" min="0" id="te2-long-aerea" value="${dp.longitudAerea || ''}"></div>
        <div><label>Longitud Red Subterránea (km)</label><input type="number" step="0.01" min="0" id="te2-long-subterranea" value="${dp.longitudSubterranea || ''}"></div>
      </div>

      <label>Potencia Total Declarada (W)</label>
      <input type="number" min="0" max="9999999" id="te2-potencia-total" value="${dp.potenciaTotalDeclaradaW || ''}">

      <div class="fila-doble">
        <div><label>Cámaras</label><input type="number" min="0" id="te2-camaras" value="${dp.camaras || 0}"></div>
        <div><label>Tomas de Tierra</label><input type="number" min="0" id="te2-tomas-tierra" value="${dp.tomasDeTierra || 0}"></div>
      </div>
      <div class="fila-doble">
        <div><label>Empalmes</label><input type="number" min="0" id="te2-empalmes" value="${dp.empalmes || 0}"></div>
        <div><label>Medidores</label><input type="number" min="0" id="te2-medidores" value="${dp.medidores || 0}"></div>
      </div>
    </div>

    <div class="seccion">
      <h3 style="margin-top:0;">Postación</h3>
      <div id="te2-postacion-lista"></div>
      <button type="button" class="btn-fila" id="btn-agregar-postacion-te2">+ Agregar tipo de poste</button>
      <p style="font-size:11px;color:#888;margin-top:6px;">La cantidad total de postes debe coincidir con la declarada en la tabla de Luminarias.</p>
    </div>

    <div class="seccion">
      <h3 style="margin-top:0;">Encargado de Alumbrado Público en el Municipio (opcional)</h3>
      <div class="fila-doble">
        <div><label>RUT</label><input type="text" id="te2-mun-rut" value="${(dp.encargadoMunicipal && dp.encargadoMunicipal.rut) || ''}"></div>
        <div><label>Nombre</label><input type="text" id="te2-mun-nombre" value="${(dp.encargadoMunicipal && dp.encargadoMunicipal.nombre) || ''}"></div>
      </div>
      <div class="fila-doble">
        <div><label>Teléfono</label><input type="tel" id="te2-mun-telefono" value="${(dp.encargadoMunicipal && dp.encargadoMunicipal.telefono) || ''}"></div>
        <div><label>Correo</label><input type="email" id="te2-mun-email" value="${(dp.encargadoMunicipal && dp.encargadoMunicipal.email) || ''}"></div>
      </div>
    </div>

    <div class="seccion" id="te1-seccion-checklist">
      <h3 style="margin-top:0;">Checklist de Verificación</h3>
      <div id="te1-checklist-items"></div>
    </div>

    <div class="seccion">
      <h3 style="margin-top:0;">Luminarias</h3>
      <div style="overflow-x:auto;">
        <table class="tabla-registros" id="tabla-luminarias-te2">
          <thead><tr>
            <th>Tipo</th><th>Potencia (W)</th><th>N° Cert. SEC</th><th>Organismo Emisor</th><th>Marca</th><th>Modelo</th>
            <th>Orig. Lum.</th><th>Orig. Postes</th><th>Final Lum.</th><th>Final Postes</th><th></th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <button type="button" class="btn-fila" id="btn-agregar-luminaria-te2" style="margin-top:8px;">+ Agregar luminaria</button>
      <p style="font-size:11px;color:#888;margin-top:6px;">Certificación SEC: verificar Sello/Folio QR en <a href="https://www.sec.cl/sello-sec/" target="_blank">sec.cl/sello-sec</a>.</p>
    </div>
  `;

  document.getElementById('btn-agregar-postacion-te2').addEventListener('click', () => agregarFilaPostacionTE2_());
  document.getElementById('btn-agregar-luminaria-te2').addEventListener('click', () => agregarFilaLuminariaTE2_());

  // El checklist TE2 es fijo (no depende de un sub-tipo, a diferencia del tipo de suministro en TE1).
  if (!expedienteActual_.checklist || !expedienteActual_.checklist.length) {
    expedienteActual_.checklist = (checklistTE2Base_ || []).map(it => Object.assign({ estado: '', observacion: '' }, it));
  }
  renderChecklistTE1_();

  ['te2-nombre-proyecto', 'te2-cantidad-planos', 'te2-fecha-pes', 'te2-ubicacion-ref', 'te2-tipo-declaracion',
    'te2-norma-ejecutada', 'te2-long-aerea', 'te2-long-subterranea', 'te2-potencia-total',
    'te2-camaras', 'te2-tomas-tierra', 'te2-empalmes', 'te2-medidores',
    'te2-mun-rut', 'te2-mun-nombre', 'te2-mun-telefono', 'te2-mun-email'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => { sincronizarDatosProyectoTE2_(); guardarBorradorTE1_(); });
  });

  (dp.postacion || []).forEach(p => agregarFilaPostacionTE2_(p));
  (e.luminarias || []).forEach(l => agregarFilaLuminariaTE2_(l));
}

function sincronizarDatosProyectoTE2_() {
  expedienteActual_.datosProyecto = {
    nombreProyecto: document.getElementById('te2-nombre-proyecto').value,
    cantidadPlanos: document.getElementById('te2-cantidad-planos').value,
    fechaPuestaEnServicio: document.getElementById('te2-fecha-pes').value,
    ubicacionReferencias: document.getElementById('te2-ubicacion-ref').value,
    tipoDeclaracion: document.getElementById('te2-tipo-declaracion').value,
    normaEjecutada: document.getElementById('te2-norma-ejecutada').value,
    longitudAerea: document.getElementById('te2-long-aerea').value,
    longitudSubterranea: document.getElementById('te2-long-subterranea').value,
    potenciaTotalDeclaradaW: document.getElementById('te2-potencia-total').value,
    camaras: document.getElementById('te2-camaras').value,
    tomasDeTierra: document.getElementById('te2-tomas-tierra').value,
    empalmes: document.getElementById('te2-empalmes').value,
    medidores: document.getElementById('te2-medidores').value,
    postacion: leerPostacionTE2_(),
    encargadoMunicipal: {
      rut: document.getElementById('te2-mun-rut').value,
      nombre: document.getElementById('te2-mun-nombre').value,
      telefono: document.getElementById('te2-mun-telefono').value,
      email: document.getElementById('te2-mun-email').value
    }
  };
}

// ---------- Postación (TE2) ----------
function agregarFilaPostacionTE2_(datosIniciales) {
  contadorPostacion_++;
  const cont = document.getElementById('te2-postacion-lista');
  const fila = document.createElement('div');
  fila.className = 'fila-doble';
  fila.style.cssText = 'margin-bottom:8px;align-items:flex-end;';
  const d = datosIniciales || {};
  fila.innerHTML = `
    <div>
      <select class="postacion-material">
        <option ${d.material === 'Metálico' ? 'selected' : ''}>Metálico</option>
        <option ${d.material === 'Hormigón' ? 'selected' : ''}>Hormigón</option>
        <option ${d.material === 'Madera' ? 'selected' : ''}>Madera</option>
        <option ${d.material === 'Otro' ? 'selected' : ''}>Otro</option>
      </select>
    </div>
    <div><input type="number" min="0" class="postacion-cantidad" placeholder="Cantidad" value="${d.cantidad || ''}"></div>
    <button type="button" class="btn-fila btn-eliminar-fila">×</button>
  `;
  fila.querySelector('.btn-eliminar-fila').addEventListener('click', () => { fila.remove(); sincronizarDatosProyectoTE2_(); guardarBorradorTE1_(); });
  fila.querySelectorAll('select, input').forEach(el => el.addEventListener('input', () => { sincronizarDatosProyectoTE2_(); guardarBorradorTE1_(); }));
  cont.appendChild(fila);
}

function leerPostacionTE2_() {
  return Array.from(document.querySelectorAll('#te2-postacion-lista > div')).map(fila => ({
    material: fila.querySelector('.postacion-material').value,
    cantidad: fila.querySelector('.postacion-cantidad').value
  })).filter(p => p.cantidad);
}

// ---------- Luminarias (TE2) ----------
function agregarFilaLuminariaTE2_(datosIniciales) {
  contadorLuminarias_++;
  const tbody = document.querySelector('#tabla-luminarias-te2 tbody');
  const fila = document.createElement('tr');
  const d = datosIniciales || {};
  fila.innerHTML = `
    <td><input type="text" class="lum-tipo" value="${d.tipo || ''}" style="width:100px;"></td>
    <td><input type="number" class="lum-potencia" value="${d.potenciaW || ''}" style="width:80px;"></td>
    <td><input type="text" class="lum-certificado" value="${d.certificadoSEC || ''}" style="width:100px;"></td>
    <td><input type="text" class="lum-organismo" value="${d.organismoEmisor || ''}" style="width:100px;"></td>
    <td><input type="text" class="lum-marca" value="${d.marca || ''}" style="width:90px;"></td>
    <td><input type="text" class="lum-modelo" value="${d.modelo || ''}" style="width:90px;"></td>
    <td><input type="number" min="0" class="lum-orig-lum" value="${d.cantidadOriginalLuminarias || 0}" style="width:60px;"></td>
    <td><input type="number" min="0" class="lum-orig-postes" value="${d.cantidadOriginalPostes || 0}" style="width:60px;"></td>
    <td><input type="number" min="0" class="lum-final-lum" value="${d.cantidadFinalLuminarias || 0}" style="width:60px;"></td>
    <td><input type="number" min="0" class="lum-final-postes" value="${d.cantidadFinalPostes || 0}" style="width:60px;"></td>
    <td><button type="button" class="btn-fila btn-eliminar-fila">×</button></td>
  `;
  fila.querySelectorAll('input').forEach(inp => inp.addEventListener('input', guardarBorradorTE1_));
  fila.querySelector('.btn-eliminar-fila').addEventListener('click', () => { fila.remove(); guardarBorradorTE1_(); });
  tbody.appendChild(fila);
}

function leerLuminariasTE2_() {
  return Array.from(document.querySelectorAll('#tabla-luminarias-te2 tbody tr')).map(fila => ({
    tipo: fila.querySelector('.lum-tipo').value,
    potenciaW: fila.querySelector('.lum-potencia').value,
    certificadoSEC: fila.querySelector('.lum-certificado').value,
    organismoEmisor: fila.querySelector('.lum-organismo').value,
    marca: fila.querySelector('.lum-marca').value,
    modelo: fila.querySelector('.lum-modelo').value,
    cantidadOriginalLuminarias: fila.querySelector('.lum-orig-lum').value,
    cantidadOriginalPostes: fila.querySelector('.lum-orig-postes').value,
    cantidadFinalLuminarias: fila.querySelector('.lum-final-lum').value,
    cantidadFinalPostes: fila.querySelector('.lum-final-postes').value
  })).filter(l => l.tipo || l.potenciaW);
}

// ---------- Checklist dinámico (compartido entre TE1 y TE2: opera sobre expedienteActual_.checklist) ----------
function renderChecklistTE1_() {
  const cont = document.getElementById('te1-checklist-items');
  const categorias = {};
  expedienteActual_.checklist.forEach((it, idx) => {
    (categorias[it.categoria] = categorias[it.categoria] || []).push(Object.assign({ idx }, it));
  });
  cont.innerHTML = Object.keys(categorias).map(cat => `
    <h4 style="margin:14px 0 6px;color:var(--azul-oscuro);">${cat}</h4>
    ${categorias[cat].map(it => `
      <div class="te1-checklist-fila" data-idx="${it.idx}" style="border-bottom:1px solid var(--borde);padding:8px 0;">
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

// ---------- Circuitos (cuadro de cargas, TE1) ----------
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
function buscarAmpacidad_(seccionTexto, canalizacion) {
  const tabla = (normativaTE1_ && normativaTE1_.corrienteAdmisibleTabla87) || {};
  const grupoPorCanalizacion = (normativaTE1_ && normativaTE1_.grupoPorCanalizacion) || {};
  const seccion = parseFloat(String(seccionTexto || '').replace(',', '.'));
  const grupo = grupoPorCanalizacion[canalizacion];
  if (!seccion || !grupo) return null;

  const leerFila = clave => (tabla[clave] ? tabla[clave][grupo] : undefined);
  const claveExacta = Object.keys(tabla).find(k => parseFloat(k) === seccion);
  if (claveExacta && leerFila(claveExacta) != null) return leerFila(claveExacta);
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
  if (!expedienteActual_.tipoTramite) {
    mensaje.textContent = 'Selecciona el tipo de trámite antes de guardar.';
    mensaje.style.color = '#c0392b';
    return;
  }
  if (expedienteActual_.tipoTramite === 'TE1' && !expedienteActual_.tipoSuministro) {
    mensaje.textContent = 'Selecciona el tipo de suministro antes de guardar.';
    mensaje.style.color = '#c0392b';
    return;
  }
  sincronizarEstadoDesdeFormularioTE1_();
  boton.disabled = true;
  mensaje.textContent = 'Guardando...';
  mensaje.style.color = '#666';

  const data = {
    codigo: expedienteActual_.codigo || '', tipoTramite: expedienteActual_.tipoTramite,
    fecha: expedienteActual_.fecha, tecnico: expedienteActual_.tecnico, cliente: expedienteActual_.cliente,
    direccion: expedienteActual_.direccion, telefono: expedienteActual_.telefono, contacto: expedienteActual_.contacto,
    correo: expedienteActual_.correo, checklist: expedienteActual_.checklist,
    puntosPropuestos: leerPuntosPropuestosTE1_()
  };
  if (expedienteActual_.tipoTramite === 'TE2') {
    sincronizarDatosProyectoTE2_();
    data.datosProyecto = expedienteActual_.datosProyecto;
    data.luminarias = leerLuminariasTE2_();
  } else {
    data.tipoSuministro = expedienteActual_.tipoSuministro;
    data.circuitos = leerCircuitosTE1_();
    data.factorDemanda = Number(document.getElementById('te1-factor-demanda').value) || 1;
    data.demandaTotalW = recalcularDemandaTotal_();
  }

  try {
    const resp = await llamarApi('guardarExpedienteSEC', [data]);
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
      await llamarApi('subirDocumentoSEC', [{ codigo: resp.pendienteSync ? '' : expedienteActual_.codigo, categoria: doc.categoria, nombreArchivo: doc.nombreArchivo, base64: doc.base64 }], refDependencia);
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
