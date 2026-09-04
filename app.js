// ---- Fill these in from Supabase: Project Settings > API > Data API ----
const SUPABASE_URL = "https://kgeyxlblximxgfntcdyy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_e2MWsX_CtAWb7wpjklZ36g_Wc17fxI2";
// --------------------------------------------------------------------------

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let myId = null;
let myUsername = "";
let targetId = null;
let targetUsername = "";
let channel = null;

function fakeEmail(username) {
  return `${username.trim().toLowerCase()}@chatapp.local`;
}

function showError(msg) {
  document.getElementById('auth-error').innerText = msg;
}

document.getElementById('signup-btn').onclick = async () => {
  const username = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  showError('');
  if (!username || !password) return showError('Enter a username and password.');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return showError('Username: 3-20 chars, letters/numbers/underscore only.');

  const { data, error } = await sb.auth.signUp({ email: fakeEmail(username), password });
  if (error) return showError(error.message);

  const { error: profileError } = await sb.from('profiles').insert({ id: data.user.id, username });
  if (profileError) return showError('Username may be taken: ' + profileError.message);

  showError('Account created. You can log in now.');
};

document.getElementById('login-btn').onclick = async () => {
  const username = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  showError('');
  if (!username || !password) return showError('Enter a username and password.');

  const { data, error } = await sb.auth.signInWithPassword({ email: fakeEmail(username), password });
  if (error) return showError('Login failed. Check your username and password.');

  myId = data.user.id;
  myUsername = username;
  enterApp();
};

document.getElementById('signout-btn').onclick = async () => {
  await sb.auth.signOut();
  if (channel) sb.removeChannel(channel);
  location.reload();
};

function enterApp() {
  document.getElementById('auth-card').style.display = 'none';
  const app = document.getElementById('app');
  app.style.display = 'flex';
  document.getElementById('my-name').innerText = myUsername;
  listenForMessages();
  loadConversations();
}

document.getElementById('back-btn').onclick = () => {
  document.getElementById('app').classList.remove('conversation-open');
};

// ---------------- Conversation list ----------------

async function loadConversations() {
  const { data: msgs, error } = await sb
    .from('messages')
    .select('*')
    .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error || !msgs || msgs.length === 0) {
    renderConversations([]);
    return;
  }

  const convMap = new Map(); // otherId -> { lastMessage, lastAt, unread }
  msgs.forEach(m => {
    const otherId = m.sender_id === myId ? m.receiver_id : m.sender_id;
    if (!convMap.has(otherId)) {
      convMap.set(otherId, { lastMessage: m.message_text, lastAt: m.created_at, unread: 0 });
    }
    if (m.receiver_id === myId && !m.read_at) {
      convMap.get(otherId).unread += 1;
    }
  });

  const otherIds = Array.from(convMap.keys());
  const { data: profiles } = await sb.from('profiles').select('id, username').in('id', otherIds);
  const nameMap = new Map((profiles || []).map(p => [p.id, p.username]));

  const conversations = otherIds.map(id => ({
    id,
    username: nameMap.get(id) || 'unknown',
    ...convMap.get(id)
  })).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  renderConversations(conversations);
}

function renderConversations(conversations) {
  const list = document.getElementById('conversation-list');
  list.innerHTML = '';

  if (conversations.length === 0) {
    list.innerHTML = '<div class="empty-list">No conversations yet</div>';
    return;
  }

  conversations.forEach(c => {
    const item = document.createElement('div');
    item.className = 'conv-item' + (c.id === targetId ? ' active' : '');
    item.innerHTML = `
      <div class="conv-avatar">${c.username.charAt(0).toUpperCase()}</div>
      <div class="conv-info">
        <div class="conv-top">
          <span class="conv-name">@${c.username}</span>
          <span class="conv-time">${formatRelativeTime(c.lastAt)}</span>
        </div>
        <div class="conv-preview${c.unread > 0 ? ' unread' : ''}">${escapeHtml(c.lastMessage)}</div>
      </div>
      ${c.unread > 0 ? `<div class="unread-badge">${c.unread}</div>` : ''}
    `;
    item.onclick = () => {
      document.getElementById('target-user').value = c.username;
      openConversation(c.username);
    };
    list.appendChild(item);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

function formatRelativeTime(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---------------- Conversation view ----------------

let lookupTimer = null;
document.getElementById('target-user').addEventListener('input', (e) => {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => openConversation(e.target.value.trim().toLowerCase()), 400);
});

async function openConversation(username) {
  const header = document.getElementById('chat-header');
  const headerText = document.getElementById('chat-header-text');
  const form = document.getElementById('msg-form');
  const messagesDiv = document.getElementById('messages');
  const app = document.getElementById('app');
  messagesDiv.innerHTML = '';
  targetId = null;
  targetUsername = '';

  if (!username) {
    header.className = 'chat-header empty';
    headerText.innerText = 'Pick someone to chat with';
    form.style.display = 'none';
    app.classList.remove('conversation-open');
    return;
  }
  if (username === myUsername) {
    header.className = 'chat-header empty';
    headerText.innerText = "That's you.";
    form.style.display = 'none';
    return;
  }

  const { data: profile, error } = await sb
    .from('profiles')
    .select('id, username')
    .eq('username', username)
    .maybeSingle();

  if (error || !profile) {
    header.className = 'chat-header empty';
    headerText.innerText = `No user @${username}`;
    form.style.display = 'none';
    return;
  }

  targetId = profile.id;
  targetUsername = profile.username;
  header.className = 'chat-header';
  headerText.innerText = `@${targetUsername}`;
  form.style.display = 'flex';
  app.classList.add('conversation-open');

  const { data: history } = await sb
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${myId},receiver_id.eq.${targetId}),and(sender_id.eq.${targetId},receiver_id.eq.${myId})`)
    .order('created_at', { ascending: true });

  (history || []).forEach(m => appendMessage(m));

  await markAsRead(targetId);
  loadConversations();
}

async function markAsRead(otherId) {
  await sb.from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('sender_id', otherId)
    .eq('receiver_id', myId)
    .is('read_at', null);
}

document.getElementById('msg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !targetId) return;
  input.value = '';

  const { error } = await sb.from('messages').insert({
    sender_id: myId,
    receiver_id: targetId,
    message_text: text
  });
  if (error) alert('Failed to send: ' + error.message);
});

// ---------------- Realtime ----------------

function listenForMessages() {
  channel = sb
    .channel('messages-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      const m = payload.new;
      if (m.sender_id !== myId && m.receiver_id !== myId) return;

      const otherId = m.sender_id === myId ? m.receiver_id : m.sender_id;
      if (otherId === targetId) {
        appendMessage(m);
        if (m.receiver_id === myId) markAsRead(targetId).then(loadConversations);
      } else {
        loadConversations();
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
      const m = payload.new;
      // A message I sent just got marked read by the other person
      if (m.sender_id === myId && m.receiver_id === targetId && m.read_at) {
        const receiptEl = document.querySelector(`[data-msg-id="${m.id}"] .receipt`);
        if (receiptEl) {
          receiptEl.textContent = '✓✓';
          receiptEl.className = 'receipt read';
        }
      }
    })
    .subscribe();
}

function appendMessage(m) {
  const messagesDiv = document.getElementById('messages');
  const mine = m.sender_id === myId;

  const row = document.createElement('div');
  row.className = 'msg-row ' + (mine ? 'mine-row' : 'theirs-row');
  row.setAttribute('data-msg-id', m.id);

  const bubble = document.createElement('div');
  bubble.className = 'msg ' + (mine ? 'mine' : 'theirs');
  bubble.innerText = m.message_text;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerHTML = `<span>${formatTime(m.created_at)}</span>`;
  if (mine) {
    const receipt = document.createElement('span');
    receipt.className = 'receipt ' + (m.read_at ? 'read' : 'sent');
    receipt.textContent = m.read_at ? '✓✓' : '✓';
    meta.appendChild(receipt);
  }

  row.appendChild(bubble);
  row.appendChild(meta);
  messagesDiv.appendChild(row);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
