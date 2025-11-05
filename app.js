// Importações do Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getDatabase, ref, set, get, onValue, push, update, remove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
// (Novo) Importações do Firebase Messaging (Notificações)
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js";

/* ========================== Firebase init ========================== */
const firebaseConfig = {
  apiKey: "AIzaSyBl8K0WVSDtGsgJygr3yCSsQ_voywnm114",
  authDomain: "gerenciador-saidas-5s-e4c58.firebaseapp.com",
  databaseURL: "https://gerenciador-saidas-5s-e4c58-default-rtdb.firebaseio.com",
  projectId: "gerenciador-saidas-5s-e4c58",
  storageBucket: "gerenciador-saidas-5s-e4c58.firebasestorage.app",
  messagingSenderId: "990056306037",
  appId: "1:990056306037:web:7bb1f8b8247631acb3af3c",
  measurementId: "G-0ZFEQRYPQT"
};

let app, db, messaging;
app = initializeApp(firebaseConfig);
db = getDatabase(app);
// (Novo) Inicializa o Firebase Messaging
try {
  messaging = getMessaging(app);
  console.log("Firebase Messaging inicializado.");
} catch(e) {
  console.error("Não foi possível inicializar o Firebase Messaging.", e);
  toast("Não foi possível carregar as notificações.", "error");
}


/* ========================== State ========================== */
const state = {
  session: null,
  settings: {
    alertLevels: [6,10,15,20],
    persistentAlarmMinutes: 25,
    defaultReason: "Banheiro",
    commonReasons: "Banheiro;Beber Água;Secretaria;Outro" // (#7)
  },
  requests: [],
  s5Teams: [],
  chatMessages: [], // (Novo)
  filaFilter: "todos", // (#8) Filtro da fila
  audioInitialized: false, // Novo
  audioCtx: null, // Novo
  alarmOn: true, // Novo
  alarmingStudents: new Set(), // Novo (para alarme persistente)
  timers: { clock:null, alert:null },
  editingItemId: null, // Para rastrear item em edição
};

/* ========================== Utils ========================== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const fmtDur = (ms)=>{
  if (isNaN(ms) || ms < 0) return "0m 0s";
  const s = Math.floor(ms/1000);
  return `${Math.floor(s/60)}m ${s%60}s`;
};
const cleanName = (n)=> (n||"").trim().toLowerCase().split(" ").filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(" ");

const formatDateTimeLocal = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const parseDateTimeLocal = (dateTimeLocalString) => {
    if (!dateTimeLocalString) return '';
    const date = new Date(dateTimeLocalString);
    return date.toISOString();
};

function toast(msg, kind="info"){
  const box = $("#toast");
  box.textContent = msg;
  box.classList.remove("hidden");
  box.style.background = kind==="error" ? "#ef4444" : (kind==="ok" ? "#065f46" : "#111827");
  setTimeout(()=>box.classList.add("hidden"), 3000);
}

/* ========================== Audio (Novo) ========================== */
function initAudio() {
  if (state.audioInitialized) return;
  try {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.audioInitialized = true;
    console.log("AudioContext inicializado.");
  } catch (e) {
    console.error("AudioContext não suportado.", e);
    toast("Áudio não pôde ser inicializado.", "error");
  }
}

function playBeep() {
  if (!state.audioCtx || !state.alarmOn) return;
  try {
    const oscillator = state.audioCtx.createOscillator();
    const gainNode = state.audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(state.audioCtx.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1000, state.audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.5, state.audioCtx.currentTime);
    
    oscillator.start(state.audioCtx.currentTime);
    oscillator.stop(state.audioCtx.currentTime + 0.2);
  } catch (e) {
    console.error("Falha ao tocar bipe:", e);
  }
}

/* ========================== Modal Genérico (Novo) ========================== */
const $modalOverlay = $("#modal-overlay");
const $modalTitle = $("#modal-title");
const $modalContent = $("#modal-content");
const $modalSave = $("#modal-save");
const $modalCancel = $("#modal-cancel");
const $modalClose = $("#modal-close");

let onModalSave = () => {};
let onModalCancel = () => {};

function openModal(title, contentHtml, saveCallback, cancelCallback = () => {}) {
  $modalTitle.textContent = title;
  $modalContent.innerHTML = contentHtml;
  onModalSave = saveCallback;
  onModalCancel = cancelCallback;
  $modalSave.textContent = "Salvar";
  $modalCancel.textContent = "Cancelar";
  $modalOverlay.classList.remove("hidden");
  $modalOverlay.classList.add("flex");
}

function closeModal() {
  $modalOverlay.classList.add("hidden");
  $modalOverlay.classList.remove("flex");
  $modalContent.innerHTML = "";
  state.editingItemId = null;
  onModalSave = () => {};
  onModalCancel = () => {};
}

$modalSave.addEventListener("click", () => onModalSave());
$modalCancel.addEventListener("click", closeModal);
$modalClose.addEventListener("click", closeModal);

function openConfirmModal(text, callback) {
  $modalTitle.textContent = "Confirmação";
  $modalContent.innerHTML = `<p>${text}</p>`;
  $modalSave.textContent = "Confirmar";
  $modalCancel.textContent = "Cancelar";
  
  onModalSave = () => {
    closeModal();
    callback(true);
  };
  
  onModalCancel = () => {
    closeModal();
    callback(false);
  };

  $modalOverlay.classList.remove("hidden");
  $modalOverlay.classList.add("flex");
}

function confirmBox(text) {
  return new Promise((resolve) => {
    openConfirmModal(text, (ok) => {
      resolve(ok);
    });
  });
}

/* ========================== (Novo) Notificações Push ========================== */
async function requestNotificationPermission() {
  if (!messaging) return;
  console.log('Pedindo permissão para notificações...');
  
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      console.log('Permissão para notificações concedida.');
      await getFCMToken();
    } else {
      console.warn('Permissão para notificações negada.');
      toast("Notificações foram bloqueadas.", "info");
    }
  } catch (error) {
    console.error('Erro ao pedir permissão de notificação:', error);
  }
}

async function getFCMToken() {
  if (!messaging) return;
  try {
    // IMPORTANTE: Substitua pela sua VAPID key do Firebase Console
    const vapidKey = "BDue5mk4XEueVCPYQRhCkM-gAmw1cLtcCl-vxpWWVBPP0W-zhzzw4ji_58Hb4SRwX9DIwOq_nddHPTJSeGBm6v0"; 
    const currentToken = await getToken(messaging, { vapidKey: vapidKey });
    
    if (currentToken) {
      console.log('Token FCM obtido:', currentToken);
      // Aqui, você salvaria o token no banco de dados associado ao usuário
      // ex: set(ref(db, `user_tokens/${state.session.user}`), currentToken);
      toast("Notificações ativadas!", "ok");
    } else {
      console.warn('Não foi possível obter o token FCM. O usuário precisa permitir.');
    }
  } catch (error) {
    console.error('Erro ao obter token FCM:', error);
    if (error.code === 'messaging/notifications-blocked') {
         toast("Notificações bloqueadas pelo navegador.", "error");
    } else if (error.code === 'messaging/invalid-vapid-key') {
         toast("Erro de configuração (VAPID Key).", "error");
         console.error("VAPID KEY INVÁLIDA. Gere uma no Console do Firebase > Configurações do Projeto > Cloud Messaging.");
    }
  }
}

// (Novo) Ouve mensagens ENQUANTO o app está aberto (foreground)
if (messaging) {
  onMessage(messaging, (payload) => {
    console.log('Mensagem recebida em primeiro plano: ', payload);
    // Mostra um toast, já que o navegador não mostrará uma notificação
    const notificationTitle = payload.notification.title || "Nova Mensagem";
    const notificationBody = payload.notification.body || "";
    toast(`${notificationTitle}: ${notificationBody}`, "info");
  });
}


/* ========================== Login ========================== */
const USERS = { "ezequiel": "Gois", "larissa":"7524" };

function showLogin(show){
  $("#login-overlay").classList.toggle("hidden", !show);
  $("#login-overlay").classList.toggle("flex", show);
  if (show) $("#login-user").focus();
}

function tryAutoLogin(){
  try {
    const raw = localStorage.getItem("sessionUser");
    if (!raw) return false;
    const sess = JSON.parse(raw);
    if (!sess || !USERS[sess.user]) return false;
    state.session = sess;
    return true;
  } catch(e){ return false; }
}

function login(user, pin){
  user = (user||"").trim().toLowerCase();
  pin = (pin||"").trim();
  if (USERS[user] && USERS[user] === pin){
    state.session = { user, ts: Date.now() };
    localStorage.setItem("sessionUser", JSON.stringify(state.session));
    showLogin(false);
    toast(`Bem-vindo, ${cleanName(user)}!`, "ok");
    
    // (Novo) Pede permissão de notificação após o login
    requestNotificationPermission();
    
    return true;
  }
  $("#login-msg").classList.remove("hidden");
  $("#login-msg").textContent = "Usuário ou PIN inválidos.";
  return false;
}

function logout(){
  localStorage.removeItem("sessionUser");
  state.session = null;
  // Aqui você poderia remover o token FCM do banco de dados
  showLogin(true);
}

/* ========================== Data bindings ========================== */
function bindRealtime(){
  onValue(ref(db, "settings"), (snap)=>{
    const s = snap.val();
    if (s) state.settings = {...state.settings, ...s};
    $("#al1").value = state.settings.alertLevels[0];
    $("#al2").value = state.settings.alertLevels[1];
    $("#al3").value = state.settings.alertLevels[2];
    $("#al4").value = state.settings.alertLevels[3];
    $("#alP").value = state.settings.persistentAlarmMinutes;
    $("#def-reason").value = state.settings.defaultReason || "";
    $("#conf-reasons").value = state.settings.commonReasons || "Banheiro;Beber Água;Secretaria;Outro";
  });

  onValue(ref(db, "saidas"), (snap)=>{
    const data = snap.val() || {};
    state.requests = Object.entries(data).map(([id, v])=> ({id, ...v}));
    renderSaídas();
  });

  onValue(ref(db, "s5Teams"), (snap)=>{
    const data = snap.val() || {};
    state.s5Teams = Object.entries(data).map(([id, v])=> ({id, ...v}));
    renderS5();
  });

  onValue(ref(db, "chatMessages"), (snap)=>{
    const data = snap.val() || {};
    state.chatMessages = Object.entries(data).map(([id, v])=> ({id, ...v}));
    state.chatMessages.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    renderChat();
  });
}

/* ========================== Render Saídas ========================== */
// Em 'Render Saídas'

function renderSaídas(){
  const pendingAll = state.requests.filter(r => r.status==="pending" || r.status==="approved");
  
  // +++ INÍCIO DA MODIFICAÇÃO (Adicionar Ordenação) +++
  pendingAll.sort((a, b) => {
    // 1. Itens pendentes sempre vêm antes dos aprovados
    if (a.status === 'pending' && b.status === 'approved') return -1;
    if (a.status === 'approved' && b.status === 'pending') return 1;

    // 2. Se ambos forem "pending", ordenar por prioridade (ou requestTime se prioridade não existir)
    if (a.status === 'pending') {
        const priA = a.priority || new Date(a.requestTime).getTime();
        const priB = b.priority || new Date(b.requestTime).getTime();
        return priA - priB; // Ordenação ascendente (mais antigo/maior prioridade primeiro)
    }

    // 3. Se ambos forem "approved", ordenar por hora de saída (o que saiu há mais tempo primeiro)
    if (a.status === 'approved') {
        return new Date(a.departureTime) - new Date(b.departureTime);
    }
    
    return 0;
  });
  // +++ FIM DA MODIFICAÇÃO (Adicionar Ordenação) +++

  const pending = pendingAll.filter(r => {
    if (state.filaFilter === 'todos') return true;
    if (state.filaFilter === 'pendentes') return r.status === 'pending';
    if (state.filaFilter === 'liberados') return r.status === 'approved';
    return true;
  });

  // ... (código do pending-count e pList.innerHTML não muda) ...
  const now = Date.now();

  // Modifique o forEach para incluir o 'index'
  pending.forEach((req, index) => { // <--- MODIFICAÇÃO (adicionar index)
    const isApproved = req.status === "approved";
    const li = document.createElement("li");
    // ... (código do 'li.className' e 'timeStr' não muda) ...
    
    const left = document.createElement("div");
    // ... (código do 'left.innerHTML' não muda) ...
    
    const right = document.createElement("div");
    right.className = "flex items-center gap-2";
    
    // +++ INÍCIO DA MODIFICAÇÃO (Adicionar botões de mover) +++
    if (!isApproved){
      let moveButtons = '';
      
      // Botão de Subir: só aparece se NÃO for o primeiro E o de cima também for 'pending'
      const hasPendingAbove = index > 0 && pending[index - 1].status === 'pending';
      if (hasPendingAbove) {
          moveButtons += `<button class="btn-icon" data-act="move-up" data-id="${req.id}" title="Mover para Cima">⬆️</button>`;
      } else {
          // Adiciona um espaço para manter o alinhamento
          moveButtons += `<span class="w-[38px] h-[38px] inline-block"></span>`;
      }
      
      // Botão de Descer: só aparece se NÃO for o último E o de baixo também for 'pending'
      const hasPendingBelow = (index < pending.length - 1) && pending[index + 1].status === 'pending';
      if (hasPendingBelow) {
          moveButtons += `<button class="btn-icon" data-act="move-down" data-id="${req.id}" title="Mover para Baixo">⬇️</button>`;
      } else {
          // Adiciona um espaço
          moveButtons += `<span class="w-[38px] h-[38px] inline-block"></span>`;
      }

      right.innerHTML = `${moveButtons}
                         <button class="btn-primary" data-act="approve" data-id="${req.id}">Liberar</button>
                         <button class="btn-danger" data-act="reject" data-id="${req.id}">Recusar</button>`;
    } else {
      right.innerHTML = `<button class="btn-secondary" data-act="return" data-id="${req.id}">Chegou</button>`;
    }
    // +++ FIM DA MODIFICAÇÃO +++

    right.innerHTML += `<button class="btn-icon" data-act="edit-saida" data-id="${req.id}">✏️</button>
                        <button class="btn-icon" data-act="del-saida" data-id="${req.id}">🗑</button>`;
    
    // ... (resto da função renderSaídas não muda) ...
  });

  const histBox = $("#history");
  histBox.innerHTML = "";
  const query = ($("#hist-search").value||"").toLowerCase();
  const byDay = {};
  history.forEach(r=>{
    if (query && !r.userName.toLowerCase().includes(query)) return;
    const d = new Date(r.requestTime||r.departureTime||Date.now());
    const key = d.toLocaleDateString("pt-BR");
    (byDay[key] ||= []).push(r);
  });
  const days = Object.keys(byDay).sort((a,b)=>{
    const da = new Date(a.split("/").reverse().join("-"));
    const db = new Date(b.split("/").reverse().join("-"));
    return db-da;
  });
  if (days.length===0){
    histBox.innerHTML = `<div class="text-sm opacity-70 italic">Histórico vazio.</div>`;
  }
  days.forEach(day=>{
    const hdr = document.createElement("div");
    hdr.className = "rounded-xl bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 px-3 py-2 font-extrabold flex items-center justify-between cursor-pointer";
    hdr.textContent = day;
    hdr.dataset.day = day;
    const caret = document.createElement("span"); caret.textContent = "▼"; caret.className = "transition-transform"; hdr.append(caret);
    const list = document.createElement("ul"); list.className="grid gap-1 bg-white dark:bg-slate-800 rounded-b-xl p-2";

    byDay[day].sort((a,b)=>(new Date(b.requestTime||b.departureTime))-(new Date(a.requestTime||a.departureTime))).forEach(r=>{
      const li = document.createElement("li");
      li.className = "flex items-center justify-between border-b border-slate-200/60 dark:border-slate-700/40 py-1";
      const t1 = r.requestTime ? new Date(r.requestTime).toLocaleTimeString("pt-BR") : "";
      const t_dep = r.departureTime ? new Date(r.departureTime).toLocaleTimeString("pt-BR") : "";
      const t_ret = r.returnTime ? new Date(r.returnTime).toLocaleTimeString("pt-BR") : "";
      
      const status = r.status==="completed" ? "Liberado" : (r.status === "rejected" ? "Recusado" : "Pendente");
      const dur = (r.returnTime && r.departureTime) ? ` (${fmtDur(new Date(r.returnTime)-new Date(r.departureTime))})` : "";
      const reason = r.reason || (r.status === 'completed' ? (state.settings.defaultReason || 'Banheiro') : (r.status === 'rejected' ? 'Recusado/Cancelado' : 'N/A'));

      li.innerHTML = `<div class="min-w-0 truncate">
                        <b>${r.userName}</b> — <span class="${r.status==='completed'?'text-emerald-600':'text-rose-600'} font-bold">${status}</span>
                        <br><span class="text-xs opacity-70">Solicitado: ${t1} ${r.departureTime ? `| Saída: ${t_dep}` : ''} ${r.returnTime ? `| Retorno: ${t_ret}` : ''} ${dur}</span>
                        <br><span class="text-xs opacity-80">Motivo: ${reason}</span>
                      </div>
                      <div class="flex gap-1">
                        <button class="btn-icon" data-act="edit-saida" data-id="${r.id}">✏️</button>
                        <button class="btn-icon" data-act="del-saida" data-id="${r.id}">🗑</button>
                      </div>`;
      list.appendChild(li);
    });
    histBox.append(hdr, list);
  });
}

/* ========================== Render S5 ========================== */
function renderS5(){
  const ul = $("#s5-list");
  ul.innerHTML = "";
  if (state.s5Teams.length===0){
    ul.innerHTML = `<li class="text-sm opacity-70 italic">Nenhuma equipe 5S registrada.</li>`;
    return;
  }
  state.s5Teams.forEach(team=>{
    const li = document.createElement("li");
    li.className = `flex items-center justify-between rounded-xl p-3 border ${team.isCompleted?'bg-emerald-50 border-emerald-400':'bg-rose-50 border-rose-400'} dark:border-transparent dark:${team.isCompleted?'bg-emerald-900/20':'bg-rose-900/20'}`;
    const list = [team.person1,team.person2,team.person3,team.person4].filter(Boolean).join(", ");
    const label = document.createElement("div");
    const reg = new Date(team.registrationTime||Date.now()).toLocaleDateString("pt-BR");
    label.innerHTML = `<div class="font-extrabold">${reg} — ${team.shift}</div>
                       <div class="text-sm opacity-80">${list}</div>` +
                       (team.notes ? `<div class="text-xs opacity-70 mt-2 p-2 bg-slate-100 dark:bg-slate-700/50 rounded-md w-full"><b>Nota:</b> ${team.notes.replace(/\n/g, '<br>')}</div>` : '');
    
    const right = document.createElement("div");
    right.className = "flex items-center gap-2";
    
    const chk = document.createElement("input");
    chk.type = "checkbox"; chk.checked = !!team.isCompleted;
    chk.addEventListener("change", ()=> update(ref(db, "s5Teams/"+team.id), { isCompleted: chk.checked }));
    
    const editBtn = document.createElement("button");
    editBtn.className = "btn-icon";
    editBtn.textContent = "✏️";
    editBtn.dataset.act = "edit-s5";
    editBtn.dataset.id = team.id;
    
    const delBtn = document.createElement("button");
    delBtn.className = "btn-icon";
    delBtn.textContent = "🗑";
    delBtn.dataset.act = "del-s5";
    delBtn.dataset.id = team.id;

    right.append(chk, editBtn, delBtn);
    li.append(label,right);
    ul.appendChild(li);
  });
}

/* ========================== Render Chat ========================== */
function renderChat() {
    const box = $("#chat-box");
    box.innerHTML = "";
    if (state.chatMessages.length === 0) {
        box.innerHTML = `<p class="text-sm opacity-70 italic">Nenhuma mensagem ainda. Comece a conversa!</p>`;
        return;
    }

    const currentUser = state.session ? state.session.user : null;

    state.chatMessages.forEach(msg => {
        const msgEl = document.createElement("div");
        const msgUser = msg.user || "Anônimo";
        const isSent = (msgUser === currentUser);
        msgEl.className = `chat-msg ${isSent ? 'sent' : 'received'}`;
        
        const bubble = document.createElement("div");
        bubble.className = "chat-msg-bubble";
        bubble.textContent = msg.text || "";
        
        const userLabel = document.createElement("span");
        userLabel.className = "chat-msg-user";
        
        userLabel.textContent = isSent ? "Você" : cleanName(msgUser); 

        msgEl.append(userLabel, bubble);

        if (isSent) {
            const actionsDiv = document.createElement("div");
            actionsDiv.className = "chat-msg-actions";
            actionsDiv.innerHTML = `
                <button class="btn-secondary btn-icon" data-act="edit-chat" data-id="${msg.id}">✏️</button>
                <button class="btn-danger btn-icon" data-act="del-chat" data-id="${msg.id}">🗑</button>
            `;
            msgEl.appendChild(actionsDiv);
        }

        box.appendChild(msgEl);
    });

    box.scrollTop = box.scrollHeight;
}

/* ========================== Actions (Saídas) ========================== */
// Em 'Actions (Saídas)'

// Esta é uma função auxiliar para pegar a lista de pendentes ORDENADA
function getSortedPendingList() {
    return state.requests
        .filter(r => r.status === 'pending')
        .sort((a, b) => {
            // Usa a prioridade ou o tempo de requisição como fallback
            const priA = a.priority || new Date(a.requestTime).getTime();
            const priB = b.priority || new Date(b.requestTime).getTime();
            return priA - priB;
        });
}

// Função para mover um item para CIMA
function moveUp(id) {
    const sortedPending = getSortedPendingList();
    const currentIndex = sortedPending.findIndex(r => r.id === id);
    
    if (currentIndex <= 0) return; // Já é o primeiro ou não foi encontrado

    const itemCurrent = sortedPending[currentIndex];
    const itemAbove = sortedPending[currentIndex - 1];

    // Pega as prioridades (ou fallback)
    const priCurrent = itemCurrent.priority || new Date(itemCurrent.requestTime).getTime();
    const priAbove = itemAbove.priority || new Date(itemAbove.requestTime).getTime();

    // Troca as prioridades no banco de dados
    update(ref(db, "saidas/" + itemCurrent.id), { priority: priAbove });
    update(ref(db, "saidas/" + itemAbove.id), { priority: priCurrent });
}

// Função para mover um item para BAIXO
function moveDown(id) {
    const sortedPending = getSortedPendingList();
    const currentIndex = sortedPending.findIndex(r => r.id === id);

    if (currentIndex < 0 || currentIndex >= sortedPending.length - 1) return; // Já é o último

    const itemCurrent = sortedPending[currentIndex];
    const itemBelow = sortedPending[currentIndex + 1];

    // Pega as prioridades (ou fallback)
    const priCurrent = itemCurrent.priority || new Date(itemCurrent.requestTime).getTime();
    const priBelow = itemBelow.priority || new Date(itemBelow.requestTime).getTime();

    // Troca as prioridades no banco de dados
    update(ref(db, "saidas/" + itemCurrent.id), { priority: priBelow });
    update(ref(db, "saidas/" + itemBelow.id), { priority: priCurrent });
}

function addStudent(){
  const name = cleanName($("#input-name").value);
  if (!name) return toast("Digite o nome do aluno.", "error");

  push(ref(db, "saidas"), {
    userName: name,
    status: "pending",
    requestTime: new Date().toISOString(),
    priority: Date.now() // <--- ADICIONE ESTA LINHA
  }).then(()=>{
    $("#input-name").value = "";
    toast(`"${name}" adicionado à fila.`, "ok");
  });
}
function approve(id){
  update(ref(db, "saidas/"+id), {
    status: "approved",
    departureTime: new Date().toISOString(),
    reason: state.settings.defaultReason || "Banheiro",
    alarmeCiente: false
  });
}
function reject(id){
  update(ref(db, "saidas/"+id), {
    status: "rejected",
    returnTime: new Date().toISOString(),
    reason: "Recusado/Cancelado"
  });
}
function arrived(id){
  update(ref(db, "saidas/"+id), {
    status: "completed",
    returnTime: new Date().toISOString(),
    alarmeCiente: false
  });
}
async function removeReq(id){
  const ok = await confirmBox("Tem certeza que deseja excluir este registro de saída?");
  if (!ok) return;
  remove(ref(db, "saidas/"+id));
  toast("Registro excluído.", "ok");
}

function openEditSaidaModal(id) {
  const req = state.requests.find(r => r.id === id);
  if (!req) return toast("Registro não encontrado.", "error");

  state.editingItemId = id;
  const currentReason = req.reason || (req.status === 'approved' || req.status === 'completed' ? (state.settings.defaultReason || 'Banheiro') : '');
  
  const requestTimeLocal = formatDateTimeLocal(req.requestTime);
  const departureTimeLocal = formatDateTimeLocal(req.departureTime);
  const returnTimeLocal = formatDateTimeLocal(req.returnTime);

  const reasons = (state.settings.commonReasons || "Banheiro;Outro").split(';').filter(Boolean);
  let isCommonReason = reasons.includes(currentReason);
  if (!isCommonReason && currentReason && !reasons.includes("Outro")) {
    reasons.push("Outro");
  } else if (!reasons.includes("Outro")) {
    reasons.push("Outro");
  }
  
  let reasonHtml = `<div class="field">
                      <label>Motivo</label>
                      <select id="edit-saida-reason-select" class="input">`;

  reasons.forEach(r => {
      const selected = (r === currentReason) || (r === "Outro" && !isCommonReason && currentReason);
      reasonHtml += `<option value="${r}" ${selected ? 'selected' : ''}>${r}</option>`;
  });
  
  reasonHtml += `</select>
              </div>
              <div class="field" id="other-reason-field" ${(!isCommonReason && currentReason) ? '' : 'style="display: none;"'}>
                  <label>Outro Motivo</label>
                  <input id="edit-saida-reason-text" class="input" value="${isCommonReason ? '' : currentReason}">
              </div>`;


  const content = `
    <div class="field">
      <label>Nome do Aluno</label>
      <input id="edit-saida-name" class="input" value="${req.userName}">
    </div>
    ${reasonHtml}
    <div class="field">
      <label>Hora de Solicitação</label>
      <input id="edit-request-time" type="datetime-local" class="input" value="${requestTimeLocal}">
    </div>
    <div class="field">
      <label>Hora de Saída</label>
      <input id="edit-departure-time" type="datetime-local" class="input" value="${departureTimeLocal}">
    </div>
    <div class="field">
      <label>Hora de Retorno</label>
      <input id="edit-return-time" type="datetime-local" class="input" value="${returnTimeLocal}">
    </div>
  `;
  openModal("Editar Saída", content, () => saveSaida(id));

  $("#edit-saida-reason-select").addEventListener("change", (e) => {
      $("#other-reason-field").style.display = (e.target.value === 'Outro') ? 'block' : 'none';
  });
}

function saveSaida(id) {
  const name = cleanName($("#edit-saida-name").value);
  
  const reasonSelect = $("#edit-saida-reason-select").value;
  let finalReason = reasonSelect;
  if (reasonSelect === "Outro") {
      finalReason = ($("#edit-saida-reason-text").value || "").trim() || "Outro";
  }

  const requestTime = parseDateTimeLocal($("#edit-request-time").value);
  const departureTime = parseDateTimeLocal($("#edit-departure-time").value);
  const returnTime = parseDateTimeLocal($("#edit-return-time").value);

  if (!name) return toast("O nome não pode ficar em branco.", "error");

  const updates = {
    userName: name,
    reason: finalReason,
    requestTime: requestTime,
    departureTime: departureTime,
    returnTime: returnTime,
  };

  if (!requestTime) updates.requestTime = null;
  if (!departureTime) updates.departureTime = null;
  if (!returnTime) updates.returnTime = null;
  
  const currentReq = state.requests.find(r => r.id === id);
  if (updates.returnTime) { 
      updates.status = "completed";
  } else if (updates.departureTime) { 
      updates.status = "approved";
  } else { 
      updates.status = "pending";
  }
  if (currentReq.status === 'rejected' && !updates.departureTime && !updates.returnTime) {
      updates.status = "rejected";
  }

  update(ref(db, "saidas/" + id), updates).then(() => {
    toast("Registro atualizado!", "ok");
    closeModal();
  });
}

/* ========================== Actions (S5) ========================== */
function addS5Team() {
  const p = ["#s5-p1", "#s5-p2", "#s5-p3", "#s5-p4"].map(sel => cleanName($(sel).value));
  const payload = {
    person1: p[0] || "Vago",
    person2: p[1] || "Vago",
    person3: p[2] || "Vago",
    person4: p[3] || "Vago",
    shift: $("#s5-shift").value,
    isCompleted: false,
    registrationTime: new Date().toISOString(),
    notes: ($("#s5-notes").value || "").trim() // (#10)
  };
  push(ref(db, "s5Teams"), payload).then(() => {
    ["#s5-p1", "#s5-p2", "#s5-p3", "#s5-p4", "#s5-notes"].forEach(sel => $(sel).value = "");
    toast("Equipe adicionada.", "ok");
  });
}

async function removeS5Team(id) {
  const ok = await confirmBox("Tem certeza que deseja excluir esta equipe 5S?");
  if (!ok) return;
  remove(ref(db, "s5Teams/" + id));
  toast("Equipe excluída.", "ok");
}

function openEditS5Modal(id) {
  const team = state.s5Teams.find(t => t.id === id);
  if (!team) return toast("Equipe não encontrada.", "error");

  state.editingItemId = id;
  const content = `
    <div class="field">
      <label>Pessoa 1</label>
      <input id="edit-s5-p1" class="input" value="${team.person1 || ''}">
    </div>
    <div class="field">
      <label>Pessoa 2</label>
      <input id="edit-s5-p2" class="input" value="${team.person2 || ''}">
    </div>
    <div class="field">
      <label>Pessoa 3</label>
      <input id="edit-s5-p3" class="input" value="${team.person3 || ''}">
    </div>
    <div class="field">
      <label>Pessoa 4</label>
      <input id="edit-s5-p4" class="input" value="${team.person4 || ''}">
    </div>
    <div class="field">
      <label>Turno</label>
      <select id="edit-s5-shift" class="input">
        <option ${team.shift === 'Manhã' ? 'selected' : ''}>Manhã</option>
        <option ${team.shift === 'Tarde' ? 'selected' : ''}>Tarde</option>
        <option ${team.shift === 'Noite' ? 'selected' : ''}>Noite</option>
      </select>
    </div>
    <!-- Notas 5S (#10) -->
    <div class="field sm:col-span-2">
      <label>Observações</label>
      <textarea id="edit-s5-notes" class="input" rows="3" placeholder="Ex: Concluído, mas lixeira do Setor B cheia.">${team.notes || ''}</textarea>
    </div>
  `;
  openModal("Editar Equipe 5S", content, () => saveS5Team(id));
}

function saveS5Team(id) {
  const p = ["#edit-s5-p1", "#edit-s5-p2", "#edit-s5-p3", "#edit-s5-p4"].map(sel => cleanName($(sel).value));
  const payload = {
    person1: p[0] || "Vago",
    person2: p[1] || "Vago",
    person3: p[2] || "Vago",
    person4: p[3] || "Vago",
    shift: $("#edit-s5-shift").value,
    notes: ($("#edit-s5-notes").value || "").trim()
  };

  update(ref(db, "s5Teams/" + id), payload).then(() => {
    toast("Equipe atualizada!", "ok");
    closeModal();
  });
}

/* ========================== Actions (Chat) ========================== */
function sendChatMessage() {
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text || !state.session) return;
    
    const payload = {
        user: state.session.user, // Salva o nome de usuário (ex: "ezequiel")
        text: text,
        timestamp: new Date().toISOString()
    };

    push(ref(db, "chatMessages"), payload).then(() => {
        input.value = "";
        $("#chat-box").scrollTop = $("#chat-box").scrollHeight;
    }).catch(err => {
        toast("Erro ao enviar mensagem.", "error");
    });
}

async function deleteChatMessage(id) {
    const ok = await confirmBox("Tem certeza que deseja excluir esta mensagem?");
    if (ok) {
        remove(ref(db, "chatMessages/" + id));
        toast("Mensagem excluída.", "ok");
    }
}

function openEditChatMessageModal(id) {
    const msg = state.chatMessages.find(m => m.id === id);
    if (!msg) return toast("Mensagem não encontrada.", "error");

    const content = `
        <div class="field">
          <label>Editar Mensagem</label>
          <textarea id="edit-chat-text" class="input" rows="3">${msg.text}</textarea>
        </div>
    `;
    openModal("Editar Mensagem", content, () => saveChatMessage(id));
}

function saveChatMessage(id) {
    const newText = $("#edit-chat-text").value.trim();
    if (newText) {
        update(ref(db, "chatMessages/" + id), { text: newText });
        toast("Mensagem atualizada!", "ok");
        closeModal();
    } else {
        toast("A mensagem não pode ficar vazia.", "error");
    }
}

async function clearAllChatMessages() {
    const ok = await confirmBox("TEM CERTEZA? Isso irá apagar TODAS as mensagens do chat para TODOS os usuários.");
    if (ok) {
        remove(ref(db, "chatMessages"));
        toast("Histórico do chat foi limpo.", "ok");
    }
}


/* ========================== Settings ========================== */
function saveSettings(){
  const vals = [$("#al1").value,$("#al2").value,$("#al3").value,$("#al4").value].map(v=>parseInt(v,10));
  const pers = parseInt($("#alP").value,10);
  if (vals.some(v=>!v||v<=0) || !pers || pers<=0){
    return toast("Valores inválidos.", "error");
  }
  for (let i=0;i<vals.length-1;i++){
    if (vals[i] >= vals[i+1]) return toast("Alertas devem ser crescentes.", "error");
  }
  if (vals[vals.length-1] >= pers) return toast("Alarme contínuo deve ser maior que o 4º alerta.", "error");
  
  const payload = {
    alertLevels: vals,
    persistentAlarmMinutes: pers,
    defaultReason: $("#def-reason").value || "Banheiro",
    commonReasons: ($("#conf-reasons").value || "").trim()
  };
  set(ref(db, "settings"), payload).then(()=>toast("Configurações salvas!", "ok"));
}

/* ========================== Backup / Reset ========================== */
async function downloadBackup(){
  const [saidasSnap, s5Snap, confSnap, chatSnap] = await Promise.all([
    get(ref(db, "saidas")),
    get(ref(db, "s5Teams")), 
    get(ref(db, "settings")),
    get(ref(db, "chatMessages"))
  ]);
  const content = {
    saidas: saidasSnap.val() || {},
    s5Teams: s5Snap.val() || {},
    settings: confSnap.val() || {},
    chatMessages: chatSnap.val() || {},
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(content, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backup_gerenciador_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function uploadBackup(file){
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("Arquivo inválido.");
    const ok = await confirmBox("Importar backup COMPLETO e substituir dados na nuvem?");
    if (!ok) throw new Error("cancel");
    
    const tasks = [];
    if (data.saidas) tasks.push(set(ref(db, "saidas"), data.saidas));
    if (data.s5Teams) tasks.push(set(ref(db, "s5Teams"), data.s5Teams));
    if (data.settings) tasks.push(set(ref(db, "settings"), data.settings));
    if (data.chatMessages) tasks.push(set(ref(db, "chatMessages"), data.chatMessages));

    await Promise.all(tasks);
    toast("Backup importado!", "ok");
  }catch(e){
    if (e.message!=="cancel") toast("Falha ao importar.", "error");
  }
}
async function resetAll(){
  const ok = await confirmBox("Resetar TUDO (saídas, 5S, chat, configs)?");
  if (!ok) return;
  await Promise.all([
    remove(ref(db, "saidas")), 
    remove(ref(db, "s5Teams")), 
    remove(ref(db, "settings")), 
    remove(ref(db, "chatMessages")),
  ]);
  toast("Tudo resetado.", "ok");
}

/* ========================== Clock & alerts ========================== */
function startClock(){
  if (state.timers.clock) clearInterval(state.timers.clock);
  
  if (state.timers.alert) clearInterval(state.timers.alert);
  state.timers.alert = null; 

  state.timers.clock = setInterval(()=>{
    const now = Date.now();
    $("#clock").textContent = new Date().toLocaleTimeString("pt-BR", {hour12:false});
    
    let shouldBeep = false;
    const { alertLevels, persistentAlarmMinutes } = state.settings;

    state.requests.forEach(r=>{
      const el = document.querySelector(`#pending-list [data-li-id="${r.id}"]`); 

      if (r.status==="pending"){
        const durEl = document.querySelector(`[data-dur="${r.id}-wait"]`);
        if (durEl) durEl.textContent = fmtDur(now - new Date(r.requestTime));
      
      } else if (r.status==="approved"){
        const durEl = document.querySelector(`[data-dur="${r.id}-out"]`);
        if (!r.departureTime) return; 
        
        const departureTime = new Date(r.departureTime).getTime();
        const elapsedMs = now - departureTime;
        if (durEl) durEl.textContent = fmtDur(elapsedMs);

        const elapsedMinutes = elapsedMs / 60000;
        
        let alertClass = '';
        if (elapsedMinutes >= alertLevels[0] && elapsedMinutes < alertLevels[1]) alertClass = 'alarm-level-1';
        else if (elapsedMinutes >= alertLevels[1] && elapsedMinutes < alertLevels[2]) alertClass = 'alarm-level-2';
        else if (elapsedMinutes >= alertLevels[2] && elapsedMinutes < alertLevels[3]) alertClass = 'alarm-level-3';
        else if (elapsedMinutes >= alertLevels[3]) alertClass = 'alarm-level-4'; 

        if (el) {
            el.classList.remove('alarm-level-1', 'alarm-level-2', 'alarm-level-3', 'alarm-level-4');
            if(alertClass) el.classList.add(alertClass);
        }
        
        if (elapsedMinutes >= persistentAlarmMinutes) {
          if (!state.alarmingStudents.has(r.id)) {
            console.log(`Alarme persistente para: ${r.userName}`);
            state.alarmingStudents.add(r.id);
            if (!r.alarmeCiente) shouldBeep = true;
          }
        } else {
          if (state.alarmingStudents.has(r.id)) {
              state.alarmingStudents.delete(r.id);
          }
        }
      } else {
         if (state.alarmingStudents.has(r.id)) {
            state.alarmingStudents.delete(r.id);
         }
         if (el) {
            el.classList.remove('alarm-level-1', 'alarm-level-2', 'alarm-level-3', 'alarm-level-4');
         }
      }
    });

    if (shouldBeep) {
        playBeep();
    }

  }, 1000); 

  state.timers.alert = setInterval(() => {
    if (state.alarmOn && state.alarmingStudents.size > 0) {
        let shouldPlay = false;
        for (const studentId of state.alarmingStudents) {
            const studentReq = state.requests.find(r => r.id === studentId);
            if (studentReq && !studentReq.alarmeCiente) {
                shouldPlay = true;
                break;
            }
        }
        
        if (shouldPlay) {
            console.log("Bipe de alarme persistente...");
            playBeep();
        }
    }
  }, 5000);
}


/* ========================== Tabs & Events ========================== */
function activateTab(id){
  $$(".tab-btn").forEach(b=>b.classList.remove("active"));
  $$("section.space-y-6 > .card").forEach(c=>c.classList.add("hidden")); 
  
  $(`[data-tab="${id}"]`).classList.add("active");
  $(`#tab-${id}`).classList.remove("hidden");
}

// Em 'Tabs & Events'

function bindEvents(){
  // ... (código do initAudio e btn-add não muda) ...

  $("#pending-list").addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.id;
    if (act==="approve") approve(id);
    if (act==="reject") reject(id);
    if (act==="return") arrived(id);
    if (act==="del-saida") removeReq(id);
    if (act==="edit-saida") openEditSaidaModal(id);
    if (act==="snooze") update(ref(db, "saidas/"+id), { alarmeCiente: true });
    if (act==="unsnooze") update(ref(db, "saidas/"+id), { alarmeCiente: false });
    // +++ ADICIONE ESTAS DUAS LINHAS +++
    if (act==="move-up") moveUp(id);
    if (act==="move-down") moveDown(id);
  });

  $("#history").addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-act]");
    if (btn){
      e.stopPropagation();
      const act = btn.dataset.act, id = btn.dataset.id;
      if (act==="del-saida") removeReq(id);
      if (act==="edit-saida") openEditSaidaModal(id);
      return;
    }
    
    const hdr = e.target.closest("div[data-day]");
    if(hdr) {
      const list = hdr.nextElementSibling;
      if(list) list.classList.toggle("hidden");
      const caret = hdr.querySelector("span");
      if(caret) caret.classList.toggle("rotate-180");
    }
  });
  
  $("#hist-search").addEventListener("input", renderSaídas);
  
  $("#s5-add").addEventListener("click", addS5Team);

  $("#s5-list").addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.id;
    if (act==="edit-s5") openEditS5Modal(id);
    if (act==="del-s5") removeS5Team(id);
  });

  $("#chat-send").addEventListener("click", sendChatMessage);
  $("#chat-input").addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { 
          e.preventDefault();
          sendChatMessage();
      }
  });
  $("#chat-box").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (act === "del-chat") deleteChatMessage(id);
      if (act === "edit-chat") openEditChatMessageModal(id);
  });
  $("#chat-clear-btn").addEventListener("click", clearAllChatMessages);


  $("#btn-save-settings").addEventListener("click", saveSettings);

  $("#ddm-header").addEventListener("click", ()=> {
    $("#ddm").classList.toggle("hidden");
    $("#ddm-caret").classList.toggle("rotate-180");
  });
  $("#btn-backup-download").addEventListener("click", downloadBackup);
  $("#file-backup").addEventListener("change", (e)=> e.target.files[0] && uploadBackup(e.target.files[0]));
  $("#btn-reset").addEventListener("click", resetAll);

  $$(".tab-btn").forEach(b=> b.addEventListener("click", ()=> activateTab(b.dataset.tab)));

  $("#alarm-pill").addEventListener("click", () => {
    state.alarmOn = !state.alarmOn;
    const pill = $("#alarm-pill");
    if (state.alarmOn) {
        pill.textContent = "ALARME: LIGADO";
        pill.classList.remove("bg-rose-200", "text-rose-800", "dark:bg-rose-800", "dark:text-rose-200");
        pill.classList.add("bg-emerald-200", "text-emerald-800", "dark:bg-emerald-800", "dark:text-emerald-200");
        toast("Alarmes ligados.", "ok");
    } else {
        pill.textContent = "ALARME: DESLIGADO";
        pill.classList.add("bg-rose-200", "text-rose-800", "dark:bg-rose-800", "dark:text-rose-200");
        pill.classList.remove("bg-emerald-200", "text-emerald-800", "dark:bg-emerald-800", "dark:text-emerald-200");
        toast("Alarmes silenciados.", "info");
    }
  });

  $("#fila-filter-buttons").addEventListener('click', (e) => {
      const filterBtn = e.target.closest('[data-fila-filter]');
      if (filterBtn) {
          $$('#fila-filter-buttons button').forEach(b => {
              b.classList.remove('btn-primary', 'active');
              b.classList.add('btn-secondary');
          });
          filterBtn.classList.add('btn-primary', 'active');
          filterBtn.classList.remove('btn-secondary');
          state.filaFilter = filterBtn.dataset.filaFilter;
          renderSaídas();
      }
  });

  $("#login-btn").addEventListener("click", ()=> {
    initAudio();
    login($("#login-user").value, $("#login-pin").value)
  });
  $("#logout-btn").addEventListener("click", logout);
}

/* ========================== Boot ========================== */
function boot(){
  if (!tryAutoLogin()) {
    showLogin(true);
  } else {
    // Se o login for automático, também pede permissão
    requestNotificationPermission();
  }
  bindEvents();
  bindRealtime();
  startClock();
  activateTab("saidas");
}

boot();
