/* ============================================================
   NotebookControl — Sistema de Empréstimo de Notebooks v2.1
   Com Agendamento, Alertas e Troca de Equipamentos
   Dados persistidos via localStorage
============================================================ */

'use strict';

// ─── CHAVES DE PERSISTÊNCIA ───────────────────────────────────
const DB_KEY_NOTEBOOKS    = 'nc_notebooks';
const DB_KEY_AGENDAMENTOS = 'nc_agendamentos';
const DB_KEY_TROCAS       = 'nc_trocas';
const DB_KEY_CONFIG       = 'nc_config';

// ─── ESTADO GLOBAL ────────────────────────────────────────────
let notebooks    = [];
let agendamentos = [];
let trocas       = [];
let config = {
  marcas:      ['Dell', 'Lenovo', 'HP'],
  modelos:     ['Latitude 5420', 'ThinkPad E14', 'ProBook 445'],
  professores: ['Coordenação', 'Prof. Silva', 'Prof. Maria']
};

let pendingCadastro    = [];
let pendingAgendamento = [];
let pendingDevolucao   = [];

let modalSerial    = null;
let trocaDefeitoso = null;
let trocaReposicao = null;

// ─── PERSISTÊNCIA ─────────────────────────────────────────────
function salvar() {
  localStorage.setItem(DB_KEY_NOTEBOOKS,    JSON.stringify(notebooks));
  localStorage.setItem(DB_KEY_AGENDAMENTOS, JSON.stringify(agendamentos));
  localStorage.setItem(DB_KEY_TROCAS,       JSON.stringify(trocas));
  localStorage.setItem(DB_KEY_CONFIG,       JSON.stringify(config));
}

function carregar() {
  try { notebooks    = JSON.parse(localStorage.getItem(DB_KEY_NOTEBOOKS))    || []; } catch { notebooks    = []; }
  try { agendamentos = JSON.parse(localStorage.getItem(DB_KEY_AGENDAMENTOS)) || []; } catch { agendamentos = []; }
  try { trocas       = JSON.parse(localStorage.getItem(DB_KEY_TROCAS))       || []; } catch { trocas       = []; }
  try {
    const savedConfig = JSON.parse(localStorage.getItem(DB_KEY_CONFIG));
    if (savedConfig) config = savedConfig;
  } catch { /* mantém config padrão */ }
}

// ─── UTILITÁRIOS ──────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateOnly(dateStr) {
  if (!dateStr) return '—';
  // Suporta tanto string ISO quanto YYYY-MM-DD
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
}

function fmtTime(timeStr) {
  if (!timeStr) return '--:--';
  return timeStr;
}

function statusLabel(s) {
  const map = {
    disponivel: 'Disponível',
    emprestado: 'Emprestado',
    manutencao: 'Em Manutenção',
    reparo:     'Reparo Profissional',
    agendado:   'Agendado',
    em_uso:     'Em Uso',
    devolvido:  'Devolvido',
    concluida:  'Concluída'
  };
  return map[s] || s;
}

function statusClass(s) {
  return 'status-badge status-' + s;
}

function toast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast-' + tipo;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function getNotebook(serial) {
  return notebooks.find(n => n.serial.trim().toUpperCase() === serial.trim().toUpperCase());
}

function getAgendamento(id) {
  return agendamentos.find(a => a.id === id);
}

// ─── NAVEGAÇÃO POR ABAS ───────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'estoque')     renderEstoque();
    if (btn.dataset.tab === 'historico')   renderHistorico();
    if (btn.dataset.tab === 'dashboard')   renderDashboard();
    if (btn.dataset.tab === 'config')      renderConfig();
    if (btn.dataset.tab === 'agendamento') { updateSelects(); renderAgendamentos(); }
    if (btn.dataset.tab === 'emprestimo')  { renderEmprestimos(); renderTrocas(); }

    // Foco automático nos inputs de scan
    setTimeout(() => {
      if (btn.dataset.tab === 'cadastro')    document.getElementById('input-cadastro-serial')?.focus();
      if (btn.dataset.tab === 'agendamento') document.getElementById('input-agend-serial')?.focus();
      if (btn.dataset.tab === 'devolucao')   document.getElementById('input-dev-serial')?.focus();
      if (btn.dataset.tab === 'emprestimo')  document.getElementById('input-troca-defeituoso')?.focus();
    }, 80);
  });
});

// ─── SISTEMA DE ALERTAS (A CADA 10 SEGUNDOS) ──────────────────
function verificarAlertas() {
  const agora = new Date();
  const alertas = [];

  agendamentos.forEach(agend => {
    if (agend.status === 'agendado') {
      const [hRet, mRet] = agend.horaRetirada.split(':').map(Number);
      const [hDev, mDev] = agend.horaDevolucao.split(':').map(Number);

      const dataRetirada = new Date(agend.data + 'T00:00:00');
      dataRetirada.setHours(hRet, mRet, 0, 0);

      const dataDevolucao = new Date(agend.data + 'T00:00:00');
      dataDevolucao.setHours(hDev, mDev, 0, 0);

      const diffRetirada = Math.floor((dataRetirada - agora) / 60000);
      if (diffRetirada >= 0 && diffRetirada <= 5 && !agend.alertaRetirada) {
        alertas.push({
          tipo: 'retirada',
          agendamento: agend,
          mensagem: `⏰ PREPARAR EQUIPAMENTOS: ${agend.professor} — Sala ${agend.setor} — Retirada em ${diffRetirada} min (${agend.horaRetirada})`
        });
        agend.alertaRetirada = true;
        salvar();
      }

      const diffDevolucao = Math.floor((dataDevolucao - agora) / 60000);
      if (diffDevolucao >= 0 && diffDevolucao <= 5 && !agend.alertaDevolucao) {
        alertas.push({
          tipo: 'devolucao',
          agendamento: agend,
          mensagem: `✓ PREPARAR DEVOLUÇÃO: ${agend.professor} — Sala ${agend.setor} — Devolução em ${diffDevolucao} min (${agend.horaDevolucao})`
        });
        agend.alertaDevolucao = true;
        salvar();
      }

      // Transição automática de status
      if (agora >= dataRetirada && agora < dataDevolucao) {
        agend.status = 'em_uso';
        agend.retiradoEm = agend.retiradoEm || agora.toISOString();
        agend.seriais.forEach(serial => {
          const nb = getNotebook(serial);
          if (nb && nb.status === 'disponivel') nb.status = 'emprestado';
        });
        salvar();
      } else if (agora >= dataDevolucao) {
        agend.status = 'devolvido';
        agend.devolvidoEm = agend.devolvidoEm || agora.toISOString();
        agend.seriais.forEach(serial => {
          const nb = getNotebook(serial);
          if (nb && nb.status === 'emprestado') nb.status = 'disponivel';
        });
        salvar();
      }
    }
  });

  renderizarAlertas(alertas);
  renderEquipamentosEmUso();

  alertas.forEach(alerta => {
    toast(alerta.mensagem, alerta.tipo === 'retirada' ? 'warn' : 'info');
  });
}

function renderizarAlertas(alertas) {
  const container = document.getElementById('alerts-container');
  if (!container) return;
  if (!alertas || alertas.length === 0) {
    container.innerHTML = '<p style="color: var(--text2); font-style: italic;">Nenhum alerta no momento.</p>';
    return;
  }
  container.innerHTML = alertas.map(alerta => `
    <div class="alert-box ${alerta.tipo === 'retirada' ? 'alert-retirada' : 'alert-devolucao'}">
      <strong>${alerta.mensagem}</strong>
    </div>
  `).join('');
}

function renderEquipamentosEmUso() {
  const tbody = document.getElementById('tbody-em-uso');
  if (!tbody) return;
  const emUso = agendamentos.filter(a => a.status === 'em_uso');

  if (emUso.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhum equipamento em uso.</td></tr>';
    return;
  }

  tbody.innerHTML = emUso.map(a => `
    <tr>
      <td><strong>${a.professor}</strong></td>
      <td>${a.setor}</td>
      <td>${a.seriais.length} notebook(s)</td>
      <td>${fmtTime(a.horaRetirada)}</td>
      <td>${fmtTime(a.horaDevolucao)}</td>
      <td><span class="status-em-uso">Em Uso</span></td>
    </tr>
  `).join('');
}

// ─── DASHBOARD ────────────────────────────────────────────────
function renderDashboard() {
  const counts = { disponivel: 0, emprestado: 0, manutencao: 0, reparo: 0 };
  notebooks.forEach(n => {
    if (counts[n.status] !== undefined) counts[n.status]++;
  });

  document.getElementById('count-disponivel').textContent = counts.disponivel;
  document.getElementById('count-emprestado').textContent = counts.emprestado;
  document.getElementById('count-manutencao').textContent = counts.manutencao;
  document.getElementById('count-reparo').textContent     = counts.reparo;
  document.getElementById('count-total').textContent      = notebooks.length;

  const tbody = document.getElementById('tbody-ultimos-emprestimos');
  if (tbody) {
    const recentes = [...agendamentos]
      .filter(a => a.status !== 'agendado')
      .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
      .slice(0, 10);

    if (recentes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Nenhum empréstimo registrado.</td></tr>';
    } else {
      tbody.innerHTML = recentes.map(a => `
        <tr>
          <td><code style="color:var(--text2);font-size:0.82rem">${a.id}</code></td>
          <td>${a.professor}</td>
          <td>${a.seriais.length}</td>
          <td>${fmtDateOnly(a.data)} ${fmtTime(a.horaRetirada)}</td>
          <td><span class="${statusClass(a.status)}">${statusLabel(a.status)}</span></td>
        </tr>
      `).join('');
    }
  }

  verificarAlertas();
}

// ─── CADASTRO ─────────────────────────────────────────────────
const inputCadastroSerial = document.getElementById('input-cadastro-serial');

inputCadastroSerial.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); adicionarPendingCadastro(); }
});
document.getElementById('btn-adicionar-serial').addEventListener('click', adicionarPendingCadastro);

function adicionarPendingCadastro() {
  const serial = inputCadastroSerial.value.trim().toUpperCase();
  if (!serial) { toast('Digite ou leia um número de série.', 'warn'); return; }

  if (pendingCadastro.includes(serial)) {
    toast('Serial já está na lista de cadastro.', 'warn');
    inputCadastroSerial.value = '';
    return;
  }
  if (getNotebook(serial)) {
    toast(`Serial ${serial} já está cadastrado no sistema.`, 'warn');
    inputCadastroSerial.value = '';
    return;
  }

  pendingCadastro.push(serial);
  inputCadastroSerial.value = '';
  renderPendingCadastro();
  inputCadastroSerial.focus();
}

function renderPendingCadastro() {
  const list  = document.getElementById('list-pending-cadastro');
  const badge = document.getElementById('badge-pending');
  badge.textContent = pendingCadastro.length;

  if (pendingCadastro.length === 0) { list.innerHTML = ''; return; }

  list.innerHTML = pendingCadastro.map((s, i) => `
    <li class="pending-item status-ok">
      <span class="item-serial">${s}</span>
      <button class="item-remove" data-index="${i}" title="Remover">&#10005;</button>
    </li>
  `).join('');

  list.querySelectorAll('.item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingCadastro.splice(parseInt(btn.dataset.index), 1);
      renderPendingCadastro();
    });
  });
}

document.getElementById('btn-confirmar-cadastro').addEventListener('click', () => {
  if (pendingCadastro.length === 0) {
    toast('Adicione ao menos um número de série.', 'warn');
    return;
  }

  const marca      = document.getElementById('select-cadastro-marca').value;
  const modelo     = document.getElementById('select-cadastro-modelo').value;
  const patrimonio = document.getElementById('input-cadastro-patrimonio').value.trim();
  const status     = document.getElementById('select-cadastro-status').value;
  const obs        = document.getElementById('input-cadastro-obs').value.trim();

  if (!marca || !modelo) {
    toast('Selecione a marca e o modelo.', 'warn');
    return;
  }

  pendingCadastro.forEach(serial => {
    notebooks.push({
      serial,
      modelo:     `${marca} ${modelo}`,
      patrimonio,
      status,
      obs,
      criadoEm: new Date().toISOString()
    });
  });

  salvar();
  toast(`${pendingCadastro.length} notebook(s) cadastrado(s) com sucesso!`, 'success');
  pendingCadastro = [];
  renderPendingCadastro();
  renderDashboard();

  document.getElementById('select-cadastro-marca').value     = '';
  document.getElementById('select-cadastro-modelo').value    = '';
  document.getElementById('input-cadastro-patrimonio').value = '';
  document.getElementById('input-cadastro-obs').value        = '';
  document.getElementById('select-cadastro-status').value    = 'disponivel';
  inputCadastroSerial.focus();
});

document.getElementById('btn-limpar-cadastro').addEventListener('click', () => {
  pendingCadastro = [];
  renderPendingCadastro();
  document.getElementById('select-cadastro-marca').value     = '';
  document.getElementById('select-cadastro-modelo').value    = '';
  document.getElementById('input-cadastro-patrimonio').value = '';
  document.getElementById('input-cadastro-obs').value        = '';
  inputCadastroSerial.value = '';
  toast('Formulário limpo.', 'info');
  inputCadastroSerial.focus();
});

// ─── AGENDAMENTO ──────────────────────────────────────────────
const inputAgendSerial = document.getElementById('input-agend-serial');

inputAgendSerial.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); adicionarPendingAgendamento(); }
});
document.getElementById('btn-adicionar-agend').addEventListener('click', adicionarPendingAgendamento);

function adicionarPendingAgendamento() {
  const serial = inputAgendSerial.value.trim().toUpperCase();
  if (!serial) { toast('Digite ou leia um número de série.', 'warn'); return; }

  const nb = getNotebook(serial);
  if (!nb) {
    toast(`Serial ${serial} não encontrado no sistema.`, 'error');
    inputAgendSerial.value = '';
    inputAgendSerial.focus();
    return;
  }
  if (pendingAgendamento.includes(serial)) {
    toast('Serial já adicionado ao agendamento.', 'warn');
    inputAgendSerial.value = '';
    return;
  }
  if (nb.status !== 'disponivel') {
    toast(`${serial} não está disponível (status: ${statusLabel(nb.status)}).`, 'error');
    inputAgendSerial.value = '';
    inputAgendSerial.focus();
    return;
  }

  pendingAgendamento.push(serial);
  inputAgendSerial.value = '';
  renderPendingAgendamento();
  inputAgendSerial.focus();
}

function renderPendingAgendamento() {
  const list  = document.getElementById('list-agend-pack');
  const badge = document.getElementById('badge-agend');
  badge.textContent = pendingAgendamento.length;

  if (pendingAgendamento.length === 0) { list.innerHTML = ''; return; }

  list.innerHTML = pendingAgendamento.map((s, i) => {
    const nb = getNotebook(s);
    return `
      <li class="pending-item status-ok">
        <span class="item-serial">${s}</span>
        ${nb ? `<span style="color:var(--text2);font-size:0.82rem">${nb.modelo || ''}</span>` : ''}
        <button class="item-remove" data-index="${i}" title="Remover">&#10005;</button>
      </li>
    `;
  }).join('');

  list.querySelectorAll('.item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingAgendamento.splice(parseInt(btn.dataset.index), 1);
      renderPendingAgendamento();
    });
  });
}

document.getElementById('btn-confirmar-agendamento').addEventListener('click', () => {
  const professor = document.getElementById('select-agend-professor').value;
  const setor     = document.getElementById('input-agend-setor').value.trim();
  const data      = document.getElementById('input-agend-data').value;
  const horaRet   = document.getElementById('input-agend-hora-retirada').value;
  const horaDev   = document.getElementById('input-agend-hora-devolucao').value;
  const obs       = document.getElementById('input-agend-obs').value.trim();

  if (!professor)                      { toast('Selecione o professor.', 'warn'); return; }
  if (!setor)                          { toast('Informe o setor/sala.', 'warn'); return; }
  if (!data || !horaRet || !horaDev)   { toast('Informe data e horários.', 'warn'); return; }
  if (pendingAgendamento.length === 0) { toast('Adicione ao menos um notebook.', 'warn'); return; }

  const agend = {
    id:            uid(),
    professor,
    setor,
    data,
    horaRetirada:  horaRet,
    horaDevolucao: horaDev,
    seriais:       [...pendingAgendamento],
    obs,
    status:        'agendado',
    criadoEm:      new Date().toISOString(),
    retiradoEm:    null,
    devolvidoEm:   null,
    alertaRetirada:  false,
    alertaDevolucao: false
  };
  agendamentos.push(agend);

  salvar();
  toast(`Agendamento ${agend.id} criado para ${professor} — ${pendingAgendamento.length} notebook(s)`, 'success');

  pendingAgendamento = [];
  renderPendingAgendamento();
  renderAgendamentos();
  renderDashboard();

  document.getElementById('select-agend-professor').value      = '';
  document.getElementById('input-agend-setor').value           = '';
  document.getElementById('input-agend-data').value            = '';
  document.getElementById('input-agend-hora-retirada').value   = '';
  document.getElementById('input-agend-hora-devolucao').value  = '';
  document.getElementById('input-agend-obs').value             = '';
  inputAgendSerial.focus();
});

document.getElementById('btn-limpar-agendamento').addEventListener('click', () => {
  pendingAgendamento = [];
  renderPendingAgendamento();
  document.getElementById('select-agend-professor').value      = '';
  document.getElementById('input-agend-setor').value           = '';
  document.getElementById('input-agend-data').value            = '';
  document.getElementById('input-agend-hora-retirada').value   = '';
  document.getElementById('input-agend-hora-devolucao').value  = '';
  document.getElementById('input-agend-obs').value             = '';
  inputAgendSerial.value = '';
  toast('Formulário limpo.', 'info');
  inputAgendSerial.focus();
});

function renderAgendamentos() {
  const tbody = document.getElementById('tbody-agendamentos');
  const lista = [...agendamentos].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum agendamento registrado.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(a => `
    <tr>
      <td>${fmtDateOnly(a.data)}</td>
      <td><strong>${a.professor}</strong></td>
      <td>${a.setor}</td>
      <td>${fmtTime(a.horaRetirada)}</td>
      <td>${fmtTime(a.horaDevolucao)}</td>
      <td>${a.seriais.length}</td>
      <td><span class="${statusClass(a.status)}">${statusLabel(a.status)}</span></td>
      <td>
        ${a.status === 'agendado'
          ? `<button class="btn-table btn-confirmar-emp" data-id="${a.id}">&#9654; Iniciar</button>`
          : '—'
        }
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-confirmar-emp').forEach(btn => {
    btn.addEventListener('click', () => confirmarEmprestimoAgendado(btn.dataset.id));
  });
}

// ─── EMPRÉSTIMO ───────────────────────────────────────────────
function renderEmprestimos() {
  // Próximos empréstimos (agendados)
  const proximos      = agendamentos.filter(a => a.status === 'agendado');
  const tbodyProximos = document.getElementById('tbody-proximos-emprestimos');

  if (proximos.length === 0) {
    tbodyProximos.innerHTML = '<tr><td colspan="7" class="empty-row">Nenhum agendamento para os próximos dias.</td></tr>';
  } else {
    tbodyProximos.innerHTML = proximos.map(a => `
      <tr>
        <td>${fmtDateOnly(a.data)}</td>
        <td><strong>${a.professor}</strong></td>
        <td>${a.setor}</td>
        <td>${fmtTime(a.horaRetirada)}</td>
        <td>${fmtTime(a.horaDevolucao)}</td>
        <td>${a.seriais.length} notebook(s)</td>
        <td>
          <button class="btn btn-sm btn-success btn-confirmar-emp" data-id="${a.id}">
            &#9654; Confirmar Retirada
          </button>
        </td>
      </tr>
    `).join('');

    tbodyProximos.querySelectorAll('.btn-confirmar-emp').forEach(btn => {
      btn.addEventListener('click', () => confirmarEmprestimoAgendado(btn.dataset.id));
    });
  }

  // Empréstimos ativos (em uso)
  const ativos      = agendamentos.filter(a => a.status === 'em_uso');
  const tbodyAtivos = document.getElementById('tbody-emprestimos-ativos');

  if (ativos.length === 0) {
    tbodyAtivos.innerHTML = '<tr><td colspan="7" class="empty-row">Nenhum empréstimo ativo no momento.</td></tr>';
  } else {
    tbodyAtivos.innerHTML = ativos.map(a => `
      <tr>
        <td>${fmtDateOnly(a.data)}</td>
        <td><strong>${a.professor}</strong></td>
        <td>${a.setor}</td>
        <td>${fmtTime(a.horaRetirada)}</td>
        <td>${fmtTime(a.horaDevolucao)}</td>
        <td>
          <div class="serial-chips">
            ${a.seriais.map(s => `<span class="serial-chip">${s}</span>`).join('')}
          </div>
        </td>
        <td><span class="status-badge status-em_uso">Em Uso</span></td>
      </tr>
    `).join('');
  }
}

function confirmarEmprestimoAgendado(agendId) {
  const agend = getAgendamento(agendId);
  if (!agend) { toast('Agendamento não encontrado.', 'error'); return; }
  if (agend.status !== 'agendado') { toast('Este agendamento não está mais disponível.', 'warn'); return; }

  agend.status     = 'em_uso';
  agend.retiradoEm = new Date().toISOString();

  agend.seriais.forEach(serial => {
    const nb = getNotebook(serial);
    if (nb) nb.status = 'emprestado';
  });

  salvar();
  toast(`Empréstimo confirmado! ${agend.seriais.length} notebook(s) retirados por ${agend.professor}`, 'success');
  renderEmprestimos();
  renderAgendamentos();
  renderDashboard();
}

// ─── DEVOLUÇÃO ────────────────────────────────────────────────
const inputDevSerial = document.getElementById('input-dev-serial');

inputDevSerial.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); adicionarPendingDevolucao(); }
});
document.getElementById('btn-adicionar-dev').addEventListener('click', adicionarPendingDevolucao);

// Atualizar select de empréstimos ativos quando a aba for aberta
function atualizarSelectEmprestimosAtivos() {
  const select = document.getElementById('select-dev-agendamento-ativo');
  if (!select) return;
  const ativos = agendamentos.filter(a => a.status === 'em_uso');
  select.innerHTML = '<option value="">Selecione um empréstimo ativo...</option>' +
    ativos.map(a => `<option value="${a.id}">${a.professor} — ${a.setor} (${a.seriais.length} notebooks)</option>`).join('');
}

document.getElementById('btn-carregar-dev-completa').addEventListener('click', () => {
  const agendId = document.getElementById('select-dev-agendamento-ativo').value;
  if (!agendId) { toast('Selecione um empréstimo ativo.', 'warn'); return; }
  const agend = getAgendamento(agendId);
  if (!agend) return;
  document.getElementById('dev-agend-prof').textContent = agend.professor;
  document.getElementById('dev-agend-setor').textContent = agend.setor;
  document.getElementById('dev-agendamento-info').style.display = 'block';
  pendingDevolucao = [...agend.seriais];
  renderPendingDevolucao();
  toast(`${agend.seriais.length} notebook(s) carregado(s) para devolução. Clique em "Confirmar Devolução" para finalizar.`, 'info');
});

// Atualizar select quando a aba for aberta
const tabBtnDevolucao = document.querySelector('[data-tab="devolucao"]');
if (tabBtnDevolucao) {
  tabBtnDevolucao.addEventListener('click', () => {
    setTimeout(() => atualizarSelectEmprestimosAtivos(), 100);
  });
}

function adicionarPendingDevolucao() {
  const serial = inputDevSerial.value.trim().toUpperCase();
  if (!serial) { toast('Digite ou leia um número de série.', 'warn'); return; }

  const nb = getNotebook(serial);
  if (!nb) {
    toast(`Serial ${serial} não encontrado no sistema.`, 'error');
    inputDevSerial.value = '';
    inputDevSerial.focus();
    return;
  }
  if (pendingDevolucao.includes(serial)) {
    toast('Serial já adicionado à devolução.', 'warn');
    inputDevSerial.value = '';
    return;
  }
  if (nb.status !== 'emprestado') {
    toast(`${serial} não está marcado como emprestado (status: ${statusLabel(nb.status)}).`, 'warn');
    inputDevSerial.value = '';
    inputDevSerial.focus();
    return;
  }

  pendingDevolucao.push(serial);
  inputDevSerial.value = '';
  renderPendingDevolucao();
  inputDevSerial.focus();
}

function renderPendingDevolucao() {
  const list  = document.getElementById('list-dev-pack');
  const badge = document.getElementById('badge-dev');
  badge.textContent = pendingDevolucao.length;

  if (pendingDevolucao.length === 0) { list.innerHTML = ''; return; }

  list.innerHTML = pendingDevolucao.map((s, i) => {
    const nb = getNotebook(s);
    return `
      <li class="pending-item status-ok">
        <span class="item-serial">${s}</span>
        ${nb ? `<span style="color:var(--text2);font-size:0.82rem">${nb.modelo || ''}</span>` : ''}
        <button class="item-remove" data-index="${i}" title="Remover">&#10005;</button>
      </li>
    `;
  }).join('');

  list.querySelectorAll('.item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingDevolucao.splice(parseInt(btn.dataset.index), 1);
      renderPendingDevolucao();
    });
  });
}

document.getElementById('btn-confirmar-devolucao').addEventListener('click', () => {
  if (pendingDevolucao.length === 0) {
    toast('Adicione ao menos um notebook para devolver.', 'warn');
    return;
  }

  pendingDevolucao.forEach(serial => {
    const nb = getNotebook(serial);
    if (nb) nb.status = 'disponivel';
  });

  // Marcar agendamentos como devolvidos quando todos os notebooks foram devolvidos
  agendamentos.forEach(agend => {
    if (agend.status === 'em_uso') {
      const todosDevolvidos = agend.seriais.every(s => {
        const nb = getNotebook(s);
        return nb && nb.status === 'disponivel';
      });
      if (todosDevolvidos) {
        agend.status      = 'devolvido';
        agend.devolvidoEm = new Date().toISOString();
      }
    }
  });

  salvar();
  toast(`${pendingDevolucao.length} notebook(s) devolvido(s) com sucesso!`, 'success');

  pendingDevolucao = [];
  renderPendingDevolucao();
  renderDashboard();
  renderAgendamentos();
  atualizarSelectEmprestimosAtivos();

  document.getElementById('input-dev-obs').value = '';
  document.getElementById('select-dev-agendamento-ativo').value = '';
  document.getElementById('dev-agendamento-info').style.display = 'none';
  inputDevSerial.focus()
});

document.getElementById('btn-limpar-devolucao').addEventListener('click', () => {
  pendingDevolucao = [];
  renderPendingDevolucao();
  document.getElementById('input-dev-obs').value = '';
  inputDevSerial.value = '';
  toast('Formulário limpo.', 'info');
  inputDevSerial.focus();
});

// ─── TROCA DE EQUIPAMENTO ─────────────────────────────────────
const inputTrocaDefeituoso = document.getElementById('input-troca-defeituoso');

inputTrocaDefeituoso.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); processarTrocaDefeituoso(); }
});
document.getElementById('btn-adicionar-defeituoso').addEventListener('click', processarTrocaDefeituoso);

function processarTrocaDefeituoso() {
  const serial = inputTrocaDefeituoso.value.trim().toUpperCase();
  if (!serial) { toast('Digite ou leia o serial do notebook defeituoso.', 'warn'); return; }

  const nb = getNotebook(serial);
  if (!nb) {
    toast(`Serial ${serial} não encontrado no sistema.`, 'error');
    inputTrocaDefeituoso.value = '';
    inputTrocaDefeituoso.focus();
    return;
  }
  if (nb.status !== 'emprestado') {
    toast(`${serial} não está em empréstimo (status: ${statusLabel(nb.status)}).`, 'warn');
    inputTrocaDefeituoso.value = '';
    inputTrocaDefeituoso.focus();
    return;
  }

  const agend = agendamentos.find(a => a.status === 'em_uso' && a.seriais.includes(serial));
  if (!agend) {
    toast('Agendamento ativo não encontrado para este notebook.', 'error');
    inputTrocaDefeituoso.value = '';
    return;
  }

  trocaDefeitoso = { serial, notebook: nb, agendamento: agend };

  document.getElementById('troca-def-serial').textContent = serial;
  document.getElementById('troca-def-modelo').textContent = nb.modelo || '—';
  document.getElementById('troca-def-agend').textContent  = agend.id;
  document.getElementById('troca-def-prof').textContent   = agend.professor;
  document.getElementById('troca-defeituoso-info').style.display = 'block';
  document.getElementById('troca-lista-reposicoes').style.display = 'none';
  document.getElementById('troca-selecao').style.display          = 'none';

  inputTrocaDefeituoso.value = '';
  toast(`Notebook ${serial} identificado como defeituoso. Clique em "Ver Disponíveis" para escolher a reposição.`, 'warn');
}

// Botão para listar reposições disponíveis
document.getElementById('btn-listar-reposicoes').addEventListener('click', () => {
  if (!trocaDefeitoso) return;

  const disponiveis = notebooks.filter(n => n.status === 'disponivel');
  const container   = document.getElementById('lista-equipamentos-disponiveis');

  if (disponiveis.length === 0) {
    container.innerHTML = `
      <p style="padding: 20px; color: var(--danger); text-align: center; font-weight: 600;">
        &#9888; Nenhum equipamento disponível no estoque para reposição.
      </p>`;
    document.getElementById('troca-lista-reposicoes').style.display = 'block';
    return;
  }

  container.innerHTML = disponiveis.map((nb, idx) => `
    <div style="
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      ${idx === 0 ? 'background: rgba(46,204,113,0.05);' : ''}
    ">
      <div>
        <p style="margin: 0; font-weight: 700; color: var(--text);">
          <code style="color: var(--accent);">${nb.serial}</code>
          ${idx === 0 ? '<span style="font-size:0.75rem; color:var(--success); margin-left:8px;">● Primeiro disponível</span>' : ''}
        </p>
        <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: var(--text2);">${nb.modelo || '—'}</p>
        ${nb.patrimonio ? `<p style="margin: 2px 0 0 0; font-size: 0.82rem; color: var(--text2);">Patrimônio: ${nb.patrimonio}</p>` : ''}
        ${nb.obs ? `<p style="margin: 2px 0 0 0; font-size: 0.82rem; color: var(--warning);">Obs: ${nb.obs}</p>` : ''}
      </div>
      <button class="btn btn-sm btn-success btn-selecionar-reposicao"
        data-serial="${nb.serial}"
        style="white-space: nowrap; min-width: 120px;">
        + Selecionar
      </button>
    </div>
  `).join('');

  document.getElementById('troca-lista-reposicoes').style.display = 'block';

  container.querySelectorAll('.btn-selecionar-reposicao').forEach(btn => {
    btn.addEventListener('click', () => selecionarReposicao(btn.dataset.serial));
  });
});

function selecionarReposicao(serial) {
  const nb = getNotebook(serial);
  if (!nb) return;

  trocaReposicao = { serial, notebook: nb };

  document.getElementById('troca-rep-serial').textContent    = serial;
  document.getElementById('troca-rep-modelo').textContent    = nb.modelo || '—';
  document.getElementById('troca-rep-patrimonio').textContent = nb.patrimonio || '—';

  document.getElementById('troca-lista-reposicoes').style.display = 'none';
  document.getElementById('troca-selecao').style.display          = 'block';
  document.getElementById('input-troca-motivo').focus();
}

document.getElementById('btn-cancelar-defeituoso').addEventListener('click', () => {
  trocaDefeitoso = null;
  trocaReposicao = null;
  document.getElementById('troca-defeituoso-info').style.display  = 'none';
  document.getElementById('troca-lista-reposicoes').style.display = 'none';
  document.getElementById('troca-selecao').style.display          = 'none';
  document.getElementById('input-troca-defeituoso').value         = '';
  document.getElementById('input-troca-motivo').value             = '';
  inputTrocaDefeituoso.focus();
  toast('Operação cancelada.', 'info');
});

document.getElementById('btn-voltar-reposicao').addEventListener('click', () => {
  trocaReposicao = null;
  document.getElementById('troca-selecao').style.display          = 'none';
  document.getElementById('troca-lista-reposicoes').style.display = 'block';
  document.getElementById('input-troca-motivo').value             = '';
});

document.getElementById('btn-confirmar-troca').addEventListener('click', () => {
  if (!trocaDefeitoso || !trocaReposicao) {
    toast('Selecione o notebook defeituoso e a reposição.', 'warn');
    return;
  }

  const motivo = document.getElementById('input-troca-motivo').value.trim();
  if (!motivo) { toast('Informe o motivo da troca.', 'warn'); return; }

  // Registrar troca
  const troca = {
    id:          uid(),
    defeitoso:   trocaDefeitoso.serial,
    reposicao:   trocaReposicao.serial,
    agendamento: trocaDefeitoso.agendamento.id,
    professor:   trocaDefeitoso.agendamento.professor,
    setor:       trocaDefeitoso.agendamento.setor,
    motivo,
    criadoEm:    new Date().toISOString(),
    status:      'concluida'
  };
  trocas.push(troca);

  // Atualizar status dos notebooks
  trocaDefeitoso.notebook.status = 'manutencao';
  trocaReposicao.notebook.status = 'emprestado';

  // Substituir serial no agendamento
  const idx = trocaDefeitoso.agendamento.seriais.indexOf(trocaDefeitoso.serial);
  if (idx !== -1) {
    trocaDefeitoso.agendamento.seriais[idx] = trocaReposicao.serial;
  }

  salvar();
  toast(`Troca realizada! ${trocaDefeitoso.serial} → ${trocaReposicao.serial}`, 'success');

  // Limpar estado
  trocaDefeitoso = null;
  trocaReposicao = null;
  document.getElementById('input-troca-motivo').value             = '';
  document.getElementById('troca-defeituoso-info').style.display  = 'none';
  document.getElementById('troca-selecao').style.display          = 'none';
  document.getElementById('troca-lista-reposicoes').style.display = 'none';
  inputTrocaDefeituoso.focus();

  renderTrocas();
  renderEmprestimos();
  renderDashboard();
});

function renderTrocas() {
  const tbody = document.getElementById('tbody-trocas');
  const lista = [...trocas].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Nenhuma troca registrada.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(t => `
    <tr>
      <td>${fmtDate(t.criadoEm)}</td>
      <td><strong>${t.professor}</strong></td>
      <td>${t.setor}</td>
      <td><code style="color:var(--danger)">${t.defeitoso}</code></td>
      <td><code style="color:var(--success)">${t.reposicao}</code></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.motivo}">${t.motivo}</td>
      <td><span class="status-badge status-devolvido">Concluída</span></td>
    </tr>
  `).join('');
}

// ─── ESTOQUE ──────────────────────────────────────────────────
function renderEstoque() {
  const filtroTexto  = document.getElementById('input-filtro-estoque').value.trim().toLowerCase();
  const filtroStatus = document.getElementById('select-filtro-status').value;

  let lista = notebooks.filter(n => {
    const matchTexto = !filtroTexto ||
      n.serial.toLowerCase().includes(filtroTexto) ||
      (n.modelo     || '').toLowerCase().includes(filtroTexto) ||
      (n.patrimonio || '').toLowerCase().includes(filtroTexto);
    const matchStatus = !filtroStatus || n.status === filtroStatus;
    return matchTexto && matchStatus;
  });

  const ordem = { disponivel: 0, emprestado: 1, manutencao: 2, reparo: 3 };
  lista.sort((a, b) => (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9));

  const tbody = document.getElementById('tbody-estoque');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhum notebook encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(n => `
    <tr>
      <td><code style="color:var(--accent);font-weight:700">${n.serial}</code></td>
      <td>${n.modelo || '<span style="color:var(--text2)">—</span>'}</td>
      <td>${n.patrimonio || '<span style="color:var(--text2)">—</span>'}</td>
      <td><span class="${statusClass(n.status)}">${statusLabel(n.status)}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${n.obs || ''}">${n.obs || '<span style="color:var(--text2)">—</span>'}</td>
      <td><button class="btn-table" data-serial="${n.serial}">Editar</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-table').forEach(btn => {
    btn.addEventListener('click', () => abrirModal(btn.dataset.serial));
  });
}

document.getElementById('input-filtro-estoque').addEventListener('input', renderEstoque);
document.getElementById('select-filtro-status').addEventListener('change', renderEstoque);

document.getElementById('btn-exportar-csv').addEventListener('click', () => {
  const header = ['Serial', 'Modelo', 'Patrimônio', 'Status', 'Observações', 'Cadastrado em'];
  const rows   = notebooks.map(n => [
    n.serial, n.modelo || '', n.patrimonio || '', statusLabel(n.status), n.obs || '', fmtDate(n.criadoEm)
  ]);
  const csv  = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `estoque_notebooks_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado com sucesso!', 'success');
});

// ─── HISTÓRICO ────────────────────────────────────────────────
function renderHistorico() {
  const filtroTexto  = document.getElementById('input-filtro-historico').value.trim().toLowerCase();
  const filtroStatus = document.getElementById('select-filtro-historico-status').value;

  let lista = agendamentos.filter(a => {
    const matchTexto = !filtroTexto ||
      a.professor.toLowerCase().includes(filtroTexto) ||
      a.id.toLowerCase().includes(filtroTexto) ||
      a.seriais.some(s => s.toLowerCase().includes(filtroTexto)) ||
      (a.setor || '').toLowerCase().includes(filtroTexto);
    const matchStatus = !filtroStatus || a.status === filtroStatus;
    return matchTexto && matchStatus;
  });

  lista = [...lista].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  const tbody = document.getElementById('tbody-historico');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Nenhum registro encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(a => `
    <tr>
      <td><code style="font-size:0.82rem;color:var(--text2)">${a.id}</code></td>
      <td><strong>${a.professor}</strong></td>
      <td>${a.setor}</td>
      <td>
        <div class="serial-chips">
          ${a.seriais.map(s => `<span class="serial-chip">${s}</span>`).join('')}
        </div>
      </td>
      <td>
        <div>${fmtDateOnly(a.data)}</div>
        <div style="color:var(--text2);font-size:0.82rem">Retirada: ${fmtTime(a.horaRetirada)}</div>
      </td>
      <td>
        <div>${fmtDateOnly(a.data)}</div>
        <div style="color:var(--text2);font-size:0.82rem">Devolução: ${fmtTime(a.horaDevolucao)}</div>
      </td>
      <td>${a.devolvidoEm ? fmtDate(a.devolvidoEm) : '—'}</td>
      <td><span class="${statusClass(a.status)}">${statusLabel(a.status)}</span></td>
      <td>—</td>
    </tr>
  `).join('');
}

document.getElementById('input-filtro-historico').addEventListener('input', renderHistorico);
document.getElementById('select-filtro-historico-status').addEventListener('change', renderHistorico);

// ─── MODAL EDITAR NOTEBOOK ────────────────────────────────────
function abrirModal(serial) {
  const nb = getNotebook(serial);
  if (!nb) return;
  modalSerial = serial;
  document.getElementById('modal-serial').textContent  = serial;
  document.getElementById('modal-select-status').value = nb.status;
  document.getElementById('modal-obs').value           = nb.obs || '';
  document.getElementById('modal-overlay').classList.remove('hidden');
}

document.getElementById('btn-modal-cancelar').addEventListener('click', fecharModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) fecharModal();
});

function fecharModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  modalSerial = null;
}

document.getElementById('btn-modal-salvar').addEventListener('click', () => {
  if (!modalSerial) return;
  const nb = getNotebook(modalSerial);
  if (!nb) return;

  nb.status = document.getElementById('modal-select-status').value;
  nb.obs    = document.getElementById('modal-obs').value.trim();
  salvar();
  fecharModal();
  renderEstoque();
  renderDashboard();
  toast(`Notebook ${modalSerial} atualizado para "${statusLabel(nb.status)}".`, 'success');
});

document.getElementById('btn-modal-excluir').addEventListener('click', () => {
  if (!modalSerial) return;
  if (!confirm(`Tem certeza que deseja excluir o notebook ${modalSerial}?`)) return;

  notebooks = notebooks.filter(n => n.serial !== modalSerial);
  salvar();
  fecharModal();
  renderEstoque();
  renderDashboard();
  toast(`Notebook ${modalSerial} excluído.`, 'info');
});

// ─── CONFIGURAÇÕES ────────────────────────────────────────────
function renderConfig() {
  renderConfigList('list-config-marcas',      config.marcas,      'marcas');
  renderConfigList('list-config-modelos',     config.modelos,     'modelos');
  renderConfigList('list-config-professores', config.professores, 'professores');
}

function renderConfigList(elementId, dataList, type) {
  const list = document.getElementById(elementId);
  list.innerHTML = dataList.map((item, i) => `
    <li class="pending-item">
      <span>${item}</span>
      <button class="item-remove" onclick="removeConfigItem('${type}', ${i})">&#10005;</button>
    </li>
  `).join('');
}

window.removeConfigItem = function(type, index) {
  config[type].splice(index, 1);
  salvar();
  renderConfig();
  updateSelects();
};

document.getElementById('btn-add-marca').onclick     = () => addConfigItem('input-config-marca',      'marcas');
document.getElementById('btn-add-modelo').onclick    = () => addConfigItem('input-config-modelo',     'modelos');
document.getElementById('btn-add-professor').onclick = () => addConfigItem('input-config-professor',  'professores');

// Enter nos inputs de config
['input-config-marca', 'input-config-modelo', 'input-config-professor'].forEach(id => {
  const map = { 'input-config-marca': 'marcas', 'input-config-modelo': 'modelos', 'input-config-professor': 'professores' };
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addConfigItem(id, map[id]); }
  });
});

function addConfigItem(inputId, type) {
  const input = document.getElementById(inputId);
  const val   = input.value.trim();
  if (!val) return;
  if (config[type].includes(val)) { toast('Item já cadastrado.', 'warn'); return; }
  config[type].push(val);
  input.value = '';
  salvar();
  renderConfig();
  updateSelects();
  toast(`"${val}" adicionado com sucesso!`, 'success');
}

function updateSelects() {
  const selMarca = document.getElementById('select-cadastro-marca');
  const selMod   = document.getElementById('select-cadastro-modelo');
  const selProf1 = document.getElementById('select-agend-professor');

  if (selMarca) {
    selMarca.innerHTML = '<option value="">Selecione uma marca...</option>' +
      config.marcas.map(m => `<option value="${m}">${m}</option>`).join('');
  }
  if (selMod) {
    selMod.innerHTML = '<option value="">Selecione um modelo...</option>' +
      config.modelos.map(m => `<option value="${m}">${m}</option>`).join('');
  }
  if (selProf1) {
    selProf1.innerHTML = '<option value="">Selecione um professor...</option>' +
      config.professores.map(p => `<option value="${p}">${p}</option>`).join('');
  }
}

// ─── DADOS DE DEMONSTRAÇÃO ────────────────────────────────────
function carregarDadosDemo() {
  if (notebooks.length > 0) return;

  const modelos    = ['Dell Latitude 5420', 'Lenovo ThinkPad E14', 'HP ProBook 445 G9', 'Acer Aspire 5', 'Samsung Galaxy Book'];
  const statusList = ['disponivel', 'disponivel', 'disponivel', 'disponivel', 'disponivel'];

  for (let i = 1; i <= 20; i++) {
    notebooks.push({
      serial:     `NB-2024-${String(i).padStart(5, '0')}`,
      modelo:     modelos[i % modelos.length],
      patrimonio: `PAT-${String(1000 + i)}`,
      status:     statusList[i % statusList.length],
      obs:        '',
      criadoEm:   new Date(Date.now() - i * 86400000).toISOString()
    });
  }

  salvar();
}

// ─── INICIALIZAÇÃO ────────────────────────────────────────────
function init() {
  carregar();
  carregarDadosDemo();
  updateSelects();
  renderDashboard();

  // Verificar alertas a cada 10 segundos
  setInterval(() => {
    if (document.getElementById('tab-dashboard').classList.contains('active')) {
      verificarAlertas();
    }
  }, 10000);
}

init();