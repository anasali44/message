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
}

// Back button: mobile only, returns from full-screen chat to the sidebar list
document.getElementById('back-btn').onclick = () => {
  document.getElementById('app').classList.remove('conversation-open');
};

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
  app.classList.add('conversation-open'); // full-screen on mobile, no-op on desktop

  const { data: history } = await sb
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${myId},receiver_id.eq.${targetId}),and(sender_id.eq.${targetId},receiver_id.eq.${myId})`)
    .order('created_at', { ascending: true });

  (history || []).forEach(m => appendMessage(m.message_text, m.sender_id === myId ? 'mine' : 'theirs'));
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

function listenForMessages() {
  channel = sb
    .channel('messages-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      const m = payload.new;
      if (!targetId) return;
      if (m.sender_id === myId && m.receiver_id === targetId) {
        appendMessage(m.message_text, 'mine');
      } else if (m.sender_id === targetId && m.receiver_id === myId) {
        appendMessage(m.message_text, 'theirs');
      }
    })
    .subscribe();
}

function appendMessage(text, type) {
  const messagesDiv = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  div.innerText = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
