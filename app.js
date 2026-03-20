/* ============================================================
   NotebookControl — Sistema de Empréstimo de Notebooks
   Versão 1.0 | Dados persistidos via localStorage
============================================================ */

'use strict';

// ─── ESTADO GLOBAL ────────────────────────────────────────────
const DB_KEY_NOTEBOOKS  = 'nc_notebooks';
const DB_KEY_EMPRESTIMOS = 'nc_emprestimos';
const DB_KEY_CONFIG      = 'nc_config';

let notebooks   = [];
let emprestimos = [];
let config = {
  marcas: ['Dell', 'Lenovo', 'HP'],
  modelos: ['Latitude 5420', 'ThinkPad E14', 'ProBook 445'],
  professores: ['Coordenação', 'Prof. Silva', 'Prof. Maria'],
  salas: ['6º ano A', '6º ano B', '7º ano A', 'Auditório']
};

let pendingCadastro  = [];  // Seriais aguardando cadastro
let pendingEmprestimo = []; // Seriais aguardando empréstimo
let pendingDevolucao  = []; // Seriais aguardando devolução

let modalSerial = null;     // Serial do notebook em edição no modal

// ─── ESTRUTURAS ───────────────────────────────────────────────
/*
  Notebook {
    serial:     string  (PK)
    modelo:     string
    patrimonio: string
    status:     'disponivel' | 'emprestado' | 'manutencao' | 'reparo'
    obs:        string
    criadoEm:   string (ISO)
  }

  Emprestimo {
    id:          string  (PK — uuid simples)
    responsavel: string
    setor:       string
    obs:          string
    previsao:    string (ISO date)
    horaRetirada: string (HH:mm)
    horaDevolucao:string (HH:mm)
    seriais:     string[]
    status:      'ativo' | 'devolvido' | 'atrasado'
    criadoEm:    string (ISO)
    devolvidoEm: string | null (ISO)
    obsDevol:    string
  }
*/

// ─── PERSISTÊNCIA ─────────────────────────────────────────────
function salvar() {
  localStorage.setItem(DB_KEY_NOTEBOOKS,   JSON.stringify(notebooks));
  localStorage.setItem(DB_KEY_EMPRESTIMOS, JSON.stringify(emprestimos));
  localStorage.setItem(DB_KEY_CONFIG,      JSON.stringify(config));
}

function carregar() {
  try { notebooks   = JSON.parse(localStorage.getItem(DB_KEY_NOTEBOOKS))  || []; } catch { notebooks   = []; }
  try { emprestimos = JSON.parse(localStorage.getItem(DB_KEY_EMPRESTIMOS)) || []; } catch { emprestimos = []; }
  try {
    const savedConfig = JSON.parse(localStorage.getItem(DB_KEY_CONFIG));
    if (savedConfig) config = savedConfig;
  } catch { }
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

function fmtDateOnly(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

function statusLabel(s) {
  const map = {
    disponivel: 'Disponível',
    emprestado: 'Emprestado',
    manutencao: 'Em Manutenção',
    reparo: 'Reparo Profissional',
    ativo: 'Em Dia',
    alerta: 'Faltam < 10min!',
    atrasado: 'ATRASADO!',
    emergencial: 'EMERGENCIAL',
    devolvido: 'Devolvido'
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
  el._timer = setTimeout(() => { el.classList.add('hidden'); }, 3200);
}

function getNotebook(serial) {
  return notebooks.find(n => n.serial.trim().toUpperCase() === serial.trim().toUpperCase());
}

// ─── NAVEGAÇÃO POR ABAS ───────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'estoque')   renderEstoque();
    if (btn.dataset.tab === 'historico') renderHistorico();
    if (btn.dataset.tab === 'dashboard') renderDashboard();
    if (btn.dataset.tab === 'config') {
      renderConfig();
      setupConfigEvents();
    }
    if (btn.dataset.tab === 'cadastro' || btn.dataset.tab === 'emprestimo') updateSelects();
  });
});

// ─── DASHBOARD ────────────────────────────────────────────────
function checkAtrasos() {
  const agora = new Date();
  const hoje = agora.toISOString().slice(0, 10);

  let mudou = false;
  emprestimos.forEach(e => {
    if (e.status === 'ativo' || e.status === 'atrasado' || e.status === 'alerta') {
      const dataPrevista = e.previsao;
      const horaLimite = e.horaDevolucao;

      if (dataPrevista && horaLimite) {
        const [h, m] = horaLimite.split(':');
        const dataLimite = new Date(dataPrevista);
        dataLimite.setHours(parseInt(h), parseInt(m), 0, 0);

        const diffMs = dataLimite - agora;
        const diffMin = Math.floor(diffMs / 60000);

        let novoStatus = 'ativo';
        if (diffMs < 0) {
          novoStatus = 'atrasado';
        } else if (diffMin <= 10) {
          novoStatus = 'alerta';
        }

        if (e.status !== novoStatus) {
          e.status = novoStatus;
          mudou = true;
        }
      }
    }
  });
  if (mudou) {
    salvar();
    renderDashboard();
    renderHistorico();
  }
}

function getTimerInfo(e) {
  if (e.status === 'devolvido') return '';

  const agora = new Date();
  const [h, m] = e.horaDevolucao.split(':');
  const dataLimite = new Date(e.previsao);
  dataLimite.setHours(parseInt(h), parseInt(m), 0, 0);

  const diffMs = dataLimite - agora;

  if (diffMs < 0) {
    const atrasoMs = Math.abs(diffMs);
    const hAtraso = Math.floor(atrasoMs / 3600000);
    const mAtraso = Math.floor((atrasoMs % 3600000) / 60000);
    return `<span class="timer-badge timer-atrasado">Atraso: ${hAtraso}h ${mAtraso}min</span>`;
  } else {
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin <= 10) {
      return `<span class="timer-badge timer-alerta">Devolver em ${diffMin} min</span>`;
    }
  }
  return '';
}

function renderDashboard() {
  checkAtrasos();
  const counts = { disponivel: 0, emprestado: 0, manutencao: 0, reparo: 0 };
  notebooks.forEach(n => { if (counts[n.status] !== undefined) counts[n.status]++; });

  document.getElementById('count-disponivel').textContent = counts.disponivel;
  document.getElementById('count-emprestado').textContent = counts.emprestado;
  document.getElementById('count-manutencao').textContent = counts.manutencao;
  document.getElementById('count-reparo').textContent     = counts.reparo;
  document.getElementById('count-total').textContent      = notebooks.length;

  const tbody = document.getElementById('tbody-ultimos-emprestimos');
  const recentes = [...emprestimos].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm)).slice(0, 10);

  if (recentes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Nenhum empréstimo registrado.</td></tr>';
    return;
  }
  tbody.innerHTML = recentes.map(e => `
    <tr>
      <td><code>${e.id}</code></td>
      <td>${e.responsavel}</td>
      <td>${e.seriais.length}</td>
      <td>
        <div>${fmtDateOnly(e.previsao)} às ${e.horaDevolucao || '--:--'}</div>
        ${getTimerInfo(e)}
      </td>
      <td><span class="${statusClass(e.status)}">${statusLabel(e.status)}</span></td>
    </tr>
  `).join('');
}

// ─── CADASTRO ─────────────────────────────────────────────────
const inputCadastroSerial = document.getElementById('input-cadastro-serial');

// Leitura automática: ao pressionar Enter (leitor de código de barras envia Enter)
inputCadastroSerial.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    adicionarPendingCadastro();
  }
});
document.getElementById('btn-adicionar-serial').addEventListener('click', adicionarPendingCadastro);

function adicionarPendingCadastro() {
  const serial = inputCadastroSerial.value.trim().toUpperCase();
  if (!serial) return;

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
  const list = document.getElementById('list-pending-cadastro');
  document.getElementById('badge-pending').textContent = pendingCadastro.length;

  if (pendingCadastro.length === 0) {
    list.innerHTML = '';
    return;
  }
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
      modelo: `${marca} ${modelo}`, 
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

  document.getElementById('input-cadastro-modelo').value     = '';
  document.getElementById('input-cadastro-patrimonio').value = '';
  document.getElementById('input-cadastro-obs').value        = '';
  document.getElementById('select-cadastro-status').value    = 'disponivel';
  inputCadastroSerial.focus();
});

document.getElementById('btn-limpar-cadastro').addEventListener('click', () => {
  pendingCadastro = [];
  renderPendingCadastro();
  document.getElementById('input-cadastro-modelo').value     = '';
  document.getElementById('input-cadastro-patrimonio').value = '';
  document.getElementById('input-cadastro-obs').value        = '';
  inputCadastroSerial.value = '';
  toast('Formulário limpo.', 'info');
});

// ─── EMPRÉSTIMO ───────────────────────────────────────────────
const inputEmpSerial = document.getElementById('input-emp-serial');

inputEmpSerial.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); adicionarPendingEmprestimo(); }
});
document.getElementById('btn-adicionar-emp').addEventListener('click', adicionarPendingEmprestimo);

function adicionarPendingEmprestimo() {
  const serial = inputEmpSerial.value.trim().toUpperCase();
  if (!serial) return;

  const nb = getNotebook(serial);
  if (!nb) {
    toast(`Serial ${serial} não encontrado no sistema.`, 'error');
    inputEmpSerial.value = '';
    inputEmpSerial.focus();
    return;
  }
  if (pendingEmprestimo.includes(serial)) {
    toast('Serial já adicionado ao pack.', 'warn');
    inputEmpSerial.value = '';
    return;
  }
  if (nb.status !== 'disponivel') {
    toast(`${serial} não está disponível (status: ${statusLabel(nb.status)}).`, 'error');
    inputEmpSerial.value = '';
    inputEmpSerial.focus();
    return;
  }

  pendingEmprestimo.push(serial);
  inputEmpSerial.value = '';
  renderPendingEmprestimo();
  inputEmpSerial.focus();
}

function renderPendingEmprestimo() {
  const list = document.getElementById('list-emp-pack');
  document.getElementById('badge-emp').textContent = pendingEmprestimo.length;

  if (pendingEmprestimo.length === 0) { list.innerHTML = ''; return; }

  list.innerHTML = pendingEmprestimo.map((s, i) => {
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
      pendingEmprestimo.splice(parseInt(btn.dataset.index), 1);
      renderPendingEmprestimo();
    });
  });
}

document.getElementById('btn-confirmar-emprestimo').addEventListener('click', () => {
  const responsavel = document.getElementById('select-emp-professor').value;
  const setor       = document.getElementById('select-emp-sala').value;
  const obs         = document.getElementById('input-emp-obs').value.trim();
  const previsao    = document.getElementById('input-emp-previsao').value;
  const hRetirada   = document.getElementById('input-emp-hora-retirada').value;
  const hDevolucao  = document.getElementById('input-emp-hora-devolucao').value;
  const isEmergencial = document.getElementById('check-emp-emergencial').checked;

  if (!responsavel) { toast('Selecione o professor responsável.', 'warn'); return; }
  if (!previsao || !hDevolucao) { toast('Informe a data e o horário limite de devolução.', 'warn'); return; }
  if (pendingEmprestimo.length === 0) { toast('Adicione ao menos um notebook ao pack.', 'warn'); return; }

  // Criar empréstimo
  const emp = {
    id: uid(),
    responsavel: isEmergencial ? `⚠️ EMERGENCIAL: ${responsavel}` : responsavel,
    setor,
    obs: isEmergencial ? `[EMERGENCIAL] ${obs}` : obs,
    previsao: previsao || null,
    horaRetirada: hRetirada || null,
    horaDevolucao: hDevolucao || null,
    seriais: [...pendingEmprestimo],
    status: isEmergencial ? 'emergencial' : 'ativo',
    criadoEm: new Date().toISOString(),
    devolvidoEm: null,
    obsDevol: ''
  };
  emprestimos.push(emp);

  // Atualizar status dos notebooks
  pendingEmprestimo.forEach(serial => {
    const nb = getNotebook(serial);
    if (nb) nb.status = 'emprestado';
  });

  salvar();
  toast(`Pack ${emp.id} — ${emp.seriais.length} notebook(s) emprestado(s) para ${responsavel}.`, 'success');

  pendingEmprestimo = [];
  renderPendingEmprestimo();
  renderDashboard();

  document.getElementById('input-emp-responsavel').value = '';
  document.getElementById('input-emp-setor').value       = '';
  document.getElementById('input-emp-obs').value         = '';
  document.getElementById('input-emp-previsao').value    = '';
  inputEmpSerial.focus();
});

document.getElementById('btn-limpar-emprestimo').addEventListener('click', () => {
  pendingEmprestimo = [];
  renderPendingEmprestimo();
  document.getElementById('input-emp-responsavel').value = '';
  document.getElementById('input-emp-setor').value       = '';
  document.getElementById('input-emp-obs').value         = '';
  document.getElementById('input-emp-previsao').value    = '';
  document.getElementById('input-emp-hora-retirada').value = '';
  document.getElementById('input-emp-hora-devolucao').value = '';
  inputEmpSerial.value = '';
  toast('Formulário limpo.', 'info');
});

// ─── DEVOLUÇÃO ────────────────────────────────────────────────
const inputDevSerial = document.getElementById('input-dev-serial');

inputDevSerial.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); adicionarPendingDevolucao(); }
});
document.getElementById('btn-adicionar-dev').addEventListener('click', adicionarPendingDevolucao);

function adicionarPendingDevolucao() {
  const serial = inputDevSerial.value.trim().toUpperCase();
  if (!serial) return;

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

  // Encontrar o empréstimo ativo que contém esse serial
  const emp = emprestimos.find(e => e.status === 'ativo' && e.seriais.includes(serial));

  pendingDevolucao.push(serial);
  inputDevSerial.value = '';
  renderPendingDevolucao();
  inputDevSerial.focus();
}

function renderPendingDevolucao() {
  const list = document.getElementById('list-dev-pack');
  document.getElementById('badge-dev').textContent = pendingDevolucao.length;

  if (pendingDevolucao.length === 0) { list.innerHTML = ''; return; }

  list.innerHTML = pendingDevolucao.map((s, i) => {
    const nb  = getNotebook(s);
    const emp = emprestimos.find(e => e.status === 'ativo' && e.seriais.includes(s));
    return `
      <li class="pending-item status-ok">
        <span class="item-serial">${s}</span>
        ${nb  ? `<span style="color:var(--text2);font-size:0.82rem">${nb.modelo || ''}</span>` : ''}
        ${emp ? `<span style="color:var(--accent);font-size:0.8rem">Pack: ${emp.id} | ${emp.responsavel}</span>` : ''}
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
  if (pendingDevolucao.length === 0) { toast('Adicione ao menos um notebook para devolver.', 'warn'); return; }

  const obsDevol = document.getElementById('input-dev-obs').value.trim();
  const agora    = new Date().toISOString();

  // Atualizar notebooks para disponível
  pendingDevolucao.forEach(serial => {
    const nb = getNotebook(serial);
    if (nb) nb.status = 'disponivel';
  });

  // Atualizar empréstimos: marcar como devolvido se todos os seriais foram devolvidos
  emprestimos.forEach(emp => {
    if (emp.status !== 'ativo') return;
    const todosDevolvidos = emp.seriais.every(s => {
      const nb = getNotebook(s);
      return nb && nb.status === 'disponivel';
    });
    if (todosDevolvidos) {
      emp.status      = 'devolvido';
      emp.devolvidoEm = agora;
      emp.obsDevol    = obsDevol;
    }
  });

  salvar();
  toast(`${pendingDevolucao.length} notebook(s) devolvido(s) com sucesso!`, 'success');

  pendingDevolucao = [];
  renderPendingDevolucao();
  renderDashboard();

  document.getElementById('input-dev-obs').value = '';
  inputDevSerial.focus();
});

document.getElementById('btn-limpar-devolucao').addEventListener('click', () => {
  pendingDevolucao = [];
  renderPendingDevolucao();
  document.getElementById('input-dev-obs').value = '';
  inputDevSerial.value = '';
  toast('Formulário limpo.', 'info');
});

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

  // Ordenar: disponivel > emprestado > manutencao > reparo
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
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${n.obs || ''}">${n.obs || '<span style="color:var(--text2)">—</span>'}</td>
      <td><button class="btn-table" data-serial="${n.serial}">Editar</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-table').forEach(btn => {
    btn.addEventListener('click', () => abrirModal(btn.dataset.serial));
  });
}

document.getElementById('input-filtro-estoque').addEventListener('input', renderEstoque);
document.getElementById('select-filtro-status').addEventListener('change', renderEstoque);

// Exportar CSV
document.getElementById('btn-exportar-csv').addEventListener('click', () => {
  const header = ['Serial', 'Modelo', 'Patrimônio', 'Status', 'Observações', 'Cadastrado em'];
  const rows   = notebooks.map(n => [
    n.serial, n.modelo || '', n.patrimonio || '', statusLabel(n.status), n.obs || '', fmtDate(n.criadoEm)
  ]);
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `estoque_notebooks_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado com sucesso!', 'success');
});

// ─── HISTÓRICO ────────────────────────────────────────────────
function renderHistorico() {
  const filtroTexto  = document.getElementById('input-filtro-historico').value.trim().toLowerCase();
  const filtroStatus = document.getElementById('select-filtro-historico-status').value;

  let lista = emprestimos.filter(e => {
    const matchTexto = !filtroTexto ||
      e.responsavel.toLowerCase().includes(filtroTexto) ||
      e.id.toLowerCase().includes(filtroTexto) ||
      e.seriais.some(s => s.toLowerCase().includes(filtroTexto)) ||
      (e.setor || '').toLowerCase().includes(filtroTexto);
    const matchStatus = !filtroStatus || e.status === filtroStatus;
    return matchTexto && matchStatus;
  });

  lista = [...lista].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  const tbody = document.getElementById('tbody-historico');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Nenhum registro encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(e => `
    <tr>
      <td><code style="font-size:0.85rem;color:var(--text2)">${e.id}</code></td>
      <td><strong>${e.responsavel}</strong></td>
      <td>${e.setor || '—'}</td>
      <td>
        <div class="serial-chips">
          ${e.seriais.map(s => `<span class="serial-chip">${s}</span>`).join('')}
        </div>
      </td>
      <td>
        <div>${fmtDateOnly(e.criadoEm)}</div>
        <div class="text-agendado">Retirada: ${e.horaRetirada || '--:--'}</div>
      </td>
      <td>
        <div>${fmtDateOnly(e.previsao)}</div>
        <div class="${e.status === 'atrasado' ? 'text-atrasado' : e.status === 'alerta' ? 'text-alerta' : 'text-agendado'}">Limite: ${e.horaDevolucao || '--:--'}</div>
        ${getTimerInfo(e)}
      </td>
      <td>${e.devolvidoEm ? fmtDate(e.devolvidoEm) : '—'}</td>
      <td><span class="${statusClass(e.status)}">${statusLabel(e.status)}</span></td>
      <td><button class="btn-table btn-edit-emp" data-id="${e.id}">Editar</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-edit-emp').forEach(btn => {
    btn.addEventListener('click', () => abrirModalEmp(btn.dataset.id));
  });
}

// ─── MODAL EDITAR EMPRÉSTIMO (RESETAR TEMPO) ──────────────────
let modalEmpId = null;

function abrirModalEmp(id) {
  const emp = emprestimos.find(e => e.id === id);
  if (!emp) return;
  modalEmpId = id;
  document.getElementById('modal-emp-id').textContent          = id;
  document.getElementById('modal-emp-responsavel').value       = emp.responsavel;
  document.getElementById('modal-emp-data').value              = emp.previsao || '';
  document.getElementById('modal-emp-hora').value              = emp.horaDevolucao || '';
  document.getElementById('modal-emp-overlay').classList.remove('hidden');
}

document.getElementById('btn-modal-emp-cancelar').addEventListener('click', fecharModalEmp);
document.getElementById('modal-emp-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-emp-overlay')) fecharModalEmp();
});

function fecharModalEmp() {
  document.getElementById('modal-emp-overlay').classList.add('hidden');
  modalEmpId = null;
}

document.getElementById('btn-modal-emp-salvar').addEventListener('click', () => {
  if (!modalEmpId) return;
  const emp = emprestimos.find(e => e.id === modalEmpId);
  if (!emp) return;

  const novoResp = document.getElementById('modal-emp-responsavel').value.trim();
  const novaData = document.getElementById('modal-emp-data').value;
  const novaHora = document.getElementById('modal-emp-hora').value;

  if (!novoResp || !novaData || !novaHora) {
    toast('Preencha todos os campos obrigatórios.', 'warn');
    return;
  }

  emp.responsavel   = novoResp;
  emp.previsao      = novaData;
  emp.horaDevolucao = novaHora;

  // Se estava atrasado, o checkAtrasos() vai atualizar o status automaticamente no próximo ciclo
  // Mas vamos forçar agora para feedback imediato
  checkAtrasos();

  salvar();
  fecharModalEmp();
  renderHistorico();
  renderDashboard();
  toast(`Empréstimo ${modalEmpId} atualizado. Cronômetro resetado se o novo horário for futuro.`, 'success');
});

document.getElementById('btn-modal-emp-excluir').addEventListener('click', () => {
  if (!modalEmpId) return;
  if (!confirm(`Deseja excluir permanentemente o registro de empréstimo ${modalEmpId}? Isso não afetará o status dos notebooks.`)) return;

  emprestimos = emprestimos.filter(e => e.id !== modalEmpId);
  salvar();
  fecharModalEmp();
  renderHistorico();
  renderDashboard();
  toast(`Registro ${modalEmpId} excluído com sucesso.`, 'info');
});

document.getElementById('input-filtro-historico').addEventListener('input', renderHistorico);
document.getElementById('select-filtro-historico-status').addEventListener('change', renderHistorico);

// ─── MODAL EDITAR NOTEBOOK ────────────────────────────────────
function abrirModal(serial) {
  const nb = getNotebook(serial);
  if (!nb) return;
  modalSerial = serial;
  document.getElementById('modal-serial').textContent        = serial;
  document.getElementById('modal-select-status').value       = nb.status;
  document.getElementById('modal-obs').value                 = nb.obs || '';
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

  const novoStatus = document.getElementById('modal-select-status').value;
  const novaObs    = document.getElementById('modal-obs').value.trim();

  // Se estava emprestado e muda para outro status, avisar
  if (nb.status === 'emprestado' && novoStatus !== 'emprestado') {
    // Marcar empréstimo ativo como devolvido parcialmente
    emprestimos.forEach(emp => {
      if (emp.status === 'ativo' && emp.seriais.includes(modalSerial)) {
        // Remove serial da lista ativa (devolução manual)
        // Não fecha o pack inteiro, apenas registra
      }
    });
  }

  nb.status = novoStatus;
  nb.obs    = novaObs;
  salvar();
  fecharModal();
  renderEstoque();
  renderDashboard();
  toast(`Notebook ${modalSerial} atualizado para "${statusLabel(novoStatus)}".`, 'success');
});

document.getElementById('btn-modal-excluir').addEventListener('click', () => {
  if (!modalSerial) return;
  const nb = getNotebook(modalSerial);
  if (!nb) return;

  if (!confirm(`Tem certeza que deseja excluir o notebook ${modalSerial}? Esta ação não pode ser desfeita.`)) return;

  notebooks = notebooks.filter(n => n.serial !== modalSerial);
  salvar();
  fecharModal();
  renderEstoque();
  renderDashboard();
  toast(`Notebook ${modalSerial} excluído.`, 'info');
});

// ─── FOCO AUTOMÁTICO NO CAMPO DE LEITURA ─────────────────────
// Quando a aba de empréstimo ou devolução é aberta, focar no campo de serial
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setTimeout(() => {
      if (btn.dataset.tab === 'emprestimo') inputEmpSerial.focus();
      if (btn.dataset.tab === 'devolucao')  inputDevSerial.focus();
      if (btn.dataset.tab === 'cadastro')   inputCadastroSerial.focus();
    }, 80);
  });
});

// ─── DADOS DE DEMONSTRAÇÃO ────────────────────────────────────
function carregarDadosDemo() {
  if (notebooks.length > 0) return; // Já tem dados

  const modelos = ['Dell Latitude 5420', 'Lenovo ThinkPad E14', 'HP ProBook 445 G9', 'Acer Aspire 5', 'Samsung Galaxy Book'];
  const statusList = ['disponivel', 'disponivel', 'disponivel', 'disponivel', 'emprestado', 'manutencao', 'reparo'];

  for (let i = 1; i <= 20; i++) {
    const serial = `NB-2024-${String(i).padStart(5, '0')}`;
    const status = statusList[i % statusList.length];
    notebooks.push({
      serial,
      modelo:     modelos[i % modelos.length],
      patrimonio: `PAT-${String(1000 + i)}`,
      status,
      obs:        status === 'manutencao' ? 'Teclado com defeito' : status === 'reparo' ? 'Placa-mãe queimada' : '',
      criadoEm:   new Date(Date.now() - i * 86400000).toISOString()
    });
  }

  // Criar empréstimos de demo para os "emprestados"
  const emprestados = notebooks.filter(n => n.status === 'emprestado').map(n => n.serial);
  if (emprestados.length > 0) {
    emprestimos.push({
      id: uid(),
      responsavel: 'João Silva',
      setor: 'Turma A — Informática',
      obs: 'Aula prática de programação',
      previsao: new Date().toISOString().slice(0, 10),
      horaRetirada: '08:00',
      horaDevolucao: '10:00', // Vai estar atrasado se for depois das 10h
      seriais: emprestados,
      status: 'ativo',
      criadoEm: new Date(Date.now() - 2 * 86400000).toISOString(),
      devolvidoEm: null,
      obsDevol: ''
    });
  }

  // Histórico devolvido
  emprestimos.push({
    id: uid(),
    responsavel: 'Maria Souza',
    setor: 'Turma B — Redes',
    obs: 'Laboratório de redes',
    previsao: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    seriais: ['NB-2024-00001', 'NB-2024-00002'],
    status: 'devolvido',
    criadoEm: new Date(Date.now() - 10 * 86400000).toISOString(),
    devolvidoEm: new Date(Date.now() - 3 * 86400000).toISOString(),
    obsDevol: 'Devolvidos em perfeito estado.'
  });

  salvar();
}

// ─── INICIALIZAÇÃO ────────────────────────────────────────────
// ─── CONFIGURAÇÕES ─────────────────────────────────────────────
function renderConfig() {
  renderConfigList('list-config-marcas', config.marcas, 'marcas');
  renderConfigList('list-config-modelos', config.modelos, 'modelos');
  renderConfigList('list-config-professores', config.professores, 'professores');
  renderConfigList('list-config-salas', config.salas, 'salas');
}

function renderConfigList(elementId, dataList, type) {
  const list = document.getElementById(elementId);
  if (!list) return;
  list.innerHTML = dataList.map((item, i) => `
    <div class="config-chip">
      <span>${item}</span>
      <button onclick="removeConfigItem('${type}', ${i})">&times;</button>
    </div>
  `).join('');
}

window.removeConfigItem = function(type, index) {
  config[type].splice(index, 1);
  salvar();
  renderConfig();
  updateSelects();
};

function setupConfigEvents() {
  const configs = [
    { btn: 'btn-add-marca', input: 'input-config-marca', type: 'marcas' },
    { btn: 'btn-add-modelo', input: 'input-config-modelo', type: 'modelos' },
    { btn: 'btn-add-professor', input: 'input-config-professor', type: 'professores' },
    { btn: 'btn-add-sala', input: 'input-config-sala', type: 'salas' }
  ];

  configs.forEach(cfg => {
    const btn = document.getElementById(cfg.btn);
    if (btn) {
      btn.onclick = () => {
        const input = document.getElementById(cfg.input);
        const val = input.value.trim();
        if (!val) return;
        if (config[cfg.type].includes(val)) { 
          toast('Já cadastrado.', 'warn'); 
          return; 
        }
        config[cfg.type].push(val);
        input.value = '';
        salvar();
        renderConfig();
        updateSelects();
        toast('Adicionado com sucesso!', 'success');
      };
    }
  });
}

function updateSelects() {
  const selMarca = document.getElementById('select-cadastro-marca');
  const selMod   = document.getElementById('select-cadastro-modelo');
  const selProf  = document.getElementById('select-emp-professor');
  const selSala  = document.getElementById('select-emp-sala');

  if (selMarca) {
    selMarca.innerHTML = '<option value="">Selecione uma marca...</option>' + 
      config.marcas.map(m => `<option value="${m}">${m}</option>`).join('');
  }
  if (selMod) {
    selMod.innerHTML = '<option value="">Selecione um modelo...</option>' + 
      config.modelos.map(m => `<option value="${m}">${m}</option>`).join('');
  }
  if (selProf) {
    selProf.innerHTML = '<option value="">Selecione um professor...</option>' + 
      config.professores.map(p => `<option value="${p}">${p}</option>`).join('');
  }
  if (selSala) {
    selSala.innerHTML = '<option value="">Selecione a sala...</option>' + 
      config.salas.map(s => `<option value="${s}">${s}</option>`).join('');
  }
}

function init() {
  carregar();
  carregarDadosDemo();
  setupConfigEvents();
  updateSelects();
  renderDashboard();

  // Monitoramento contínuo (a cada 30 segundos)
  setInterval(checkAtrasos, 30000);
  checkAtrasos();
}

init();