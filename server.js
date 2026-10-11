const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { ROLES, DEPTS, users, groups, history, addUser, addGroup } = require('./data');
const P = require('./policies');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

// Serve the UI from ./public/index.html (or from next to server.js if it was placed there by mistake)
app.get('/', (req, res) => {
  for (const f of [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')]) {
    if (require('fs').existsSync(f)) return res.sendFile(f);
  }
  res.status(404).send('index.html not found. Put it in a folder named "public" next to server.js.');
});

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 200;
const MAX_TEXT = 1000;

// ------------------------------------------------------------------ helpers
const pub = u => ({ id: u.id, name: u.name, role: u.role, dept: u.dept });
const dmRoom = (a, b) => 'dm:' + [a, b].sort().join('|');
const online = new Map(); // userId -> open socket count

function groupView(g, user) {
  return {
    id: g.id, name: g.name, type: g.type, dept: g.dept, ownerId: g.ownerId,
    allowedRoles: g.allowedRoles, postRoles: g.postRoles,
    canPost: P.canPost(user, g), canManage: P.canManage(user, g),
    members: [...g.members].map(id => users.get(id)).filter(Boolean).map(pub),
    muted: [...g.muted],
  };
}

function buildState(user) {
  const myGroups = [...groups.values()].filter(g => P.hasAccess(user, g)).map(g => groupView(g, user));
  const everyone = [...users.values()].filter(u => u.id !== user.id);
  const contacts = everyone.filter(u => P.canDM(user, u)).map(pub);
  // Directory (used by admin/HoD/faculty to pick members). Students never receive it.
  const directory = user.role === 'student' ? [] : everyone.map(pub);
  return { me: pub(user), groups: myGroups, contacts, directory, roles: ROLES, depts: DEPTS };
}

/** Push fresh state to a socket and make its Socket.IO rooms match its permissions. */
function sync(socket) {
  const user = users.get(socket.data.userId);
  if (!user) return;
  const allowed = new Set([...groups.values()].filter(g => P.hasAccess(user, g)).map(g => 'group:' + g.id));
  for (const r of socket.rooms) if (r.startsWith('group:') && !allowed.has(r)) socket.leave(r);
  for (const r of allowed) socket.join(r);
  socket.emit('state', buildState(user));
}
const syncAll = () => { for (const [, s] of io.sockets.sockets) sync(s); };
const broadcastPresence = () => io.emit('presence', [...online.keys()]);

function clean(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim().slice(0, MAX_TEXT);
  return t.length ? t : null;
}
function store(room, msg) {
  const list = history.get(room) || [];
  list.push(msg);
  if (list.length > MAX_HISTORY) list.shift();
  history.set(room, list);
}
const mkMsg = (room, user, text) => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  room, from: pub(user), text, ts: Date.now(),
});

// ---------------------------------------------------------------- auth
io.use((socket, next) => {
  const { id, password } = socket.handshake.auth || {};
  const u = users.get((id || '').trim());
  if (!u || u.password !== password) return next(new Error('Invalid ID or password.'));
  socket.data.userId = u.id;
  next();
});

// ------------------------------------------------------------ connection
io.on('connection', socket => {
  const me = () => users.get(socket.data.userId);
  online.set(me().id, (online.get(me().id) || 0) + 1);
  sync(socket);
  broadcastPresence();

  // simple flood control: max 8 messages / 5 s per socket
  let stamps = [];
  const flooded = () => {
    const now = Date.now();
    stamps = stamps.filter(t => now - t < 5000);
    if (stamps.length >= 8) return true;
    stamps.push(now);
    return false;
  };

  // ---- group messaging
  socket.on('group:history', (groupId, ack) => {
    const g = groups.get(groupId);
    if (!g || !P.hasAccess(me(), g)) return ack?.({ error: 'Not a member of this group.' });
    ack?.({ messages: history.get('group:' + g.id) || [] });
  });

  socket.on('group:message', ({ groupId, text } = {}, ack) => {
    const g = groups.get(groupId), t = clean(text);
    if (!g || !t) return ack?.({ error: 'Invalid message.' });
    if (!P.hasAccess(me(), g)) return ack?.({ error: 'You are not a member of this group.' });
    if (!P.canPost(me(), g)) return ack?.({ error: 'You cannot post in this group (read-only or muted).' });
    if (flooded()) return ack?.({ error: 'Slow down — too many messages.' });
    const msg = mkMsg('group:' + g.id, me(), t);
    store(msg.room, msg);
    io.to(msg.room).emit('message', msg);
    ack?.({ ok: true });
  });

  // ---- direct messaging
  socket.on('dm:history', (peerId, ack) => {
    const peer = users.get(peerId);
    if (!peer || !P.canDM(me(), peer)) return ack?.({ error: 'Direct messaging not allowed.' });
    ack?.({ messages: history.get(dmRoom(me().id, peer.id)) || [] });
  });

  socket.on('dm:message', ({ to, text } = {}, ack) => {
    const peer = users.get(to), t = clean(text);
    if (!peer || !t) return ack?.({ error: 'Invalid message.' });
    if (!P.canDM(me(), peer)) return ack?.({ error: `Policy: ${me().role}s cannot message this user.` });
    if (flooded()) return ack?.({ error: 'Slow down — too many messages.' });
    const msg = mkMsg(dmRoom(me().id, peer.id), me(), t);
    msg.to = peer.id;
    store(msg.room, msg);
    io.to('user:' + me().id).to('user:' + peer.id).emit('message', msg);
    ack?.({ ok: true });
  });

  socket.join('user:' + me().id);

  socket.on('typing', ({ groupId, to } = {}) => {
    const payload = { user: me().name };
    if (groupId) {
      const g = groups.get(groupId);
      if (g && P.canPost(me(), g)) socket.to('group:' + g.id).emit('typing', { ...payload, room: 'group:' + g.id });
    } else if (to) {
      const peer = users.get(to);
      if (peer && P.canDM(me(), peer)) io.to('user:' + peer.id).emit('typing', { ...payload, room: dmRoom(me().id, peer.id) });
    }
  });

  // ---- administration: add users (admin only)
  socket.on('user:create', (d = {}, ack) => {
    if (!P.isAdmin(me())) return ack?.({ error: 'Only the admin office can add users.' });
    const id = (d.id || '').trim(), name = (d.name || '').trim();
    if (!id || !name || !d.password) return ack?.({ error: 'ID, name and password are required.' });
    if (users.has(id)) return ack?.({ error: 'A user with this ID already exists.' });
    if (!ROLES.includes(d.role) || !DEPTS.includes(d.dept)) return ack?.({ error: 'Invalid role or department.' });
    addUser({ id, name, role: d.role, dept: d.dept, password: d.password });
    // Auto-enrol into university-wide channels (notices, transport, helpdesk)
    for (const g of groups.values()) if (g.autoEnroll && P.canBeMember(users.get(id), g)) g.members.add(id);
    syncAll();
    ack?.({ ok: true });
  });

  // ---- group creation (admin / HoD / faculty, each with limits)
  socket.on('group:create', (d = {}, ack) => {
    const spec = {
      name: (d.name || '').trim(), type: d.type, dept: d.dept || null,
      allowedRoles: d.allowedRoles, postRoles: d.postRoles,
    };
    const err = P.validateCreate(me(), spec);
    if (err) return ack?.({ error: err });
    if (!P.isAdmin(me()) && !spec.allowedRoles.includes(me().role)) spec.allowedRoles.push(me().role);
    const g = addGroup({ ...spec, ownerId: me().id });
    const skipped = [];
    const initial = [...(Array.isArray(d.members) ? d.members : [])];
    if (!P.isAdmin(me())) initial.push(me().id);
    for (const uid of initial) {
      const u = users.get(uid);
      if (u && P.canBeMember(u, g)) g.members.add(uid); else if (u) skipped.push(u.name);
    }
    syncAll();
    ack?.({ ok: true, groupId: g.id, skipped });
  });

  const managed = (groupId, ack) => {
    const g = groups.get(groupId);
    if (!g) { ack?.({ error: 'Group not found.' }); return null; }
    if (!P.canManage(me(), g)) { ack?.({ error: 'You are not allowed to manage this group.' }); return null; }
    return g;
  };

  socket.on('group:addMember', ({ groupId, userId } = {}, ack) => {
    const g = managed(groupId, ack); if (!g) return;
    const u = users.get(userId);
    if (!u) return ack?.({ error: 'User not found.' });
    if (!P.canBeMember(u, g)) {
      const why = !g.allowedRoles.includes(u.role)
        ? `${u.role}s are not allowed in this group.` : `This group is limited to the ${g.dept} department.`;
      return ack?.({ error: `Boundary: ${why}` });
    }
    g.members.add(u.id);
    syncAll();
    ack?.({ ok: true });
  });

  socket.on('group:removeMember', ({ groupId, userId } = {}, ack) => {
    const g = managed(groupId, ack); if (!g) return;
    if (userId === g.ownerId) return ack?.({ error: 'The group owner cannot be removed.' });
    g.members.delete(userId); g.muted.delete(userId);
    syncAll();
    ack?.({ ok: true });
  });

  socket.on('group:toggleMute', ({ groupId, userId } = {}, ack) => {
    const g = managed(groupId, ack); if (!g) return;
    if (!g.members.has(userId) || userId === g.ownerId) return ack?.({ error: 'Cannot mute this member.' });
    g.muted.has(userId) ? g.muted.delete(userId) : g.muted.add(userId);
    syncAll();
    ack?.({ ok: true });
  });

  socket.on('group:delete', (groupId, ack) => {
    const g = managed(groupId, ack); if (!g) return;
    groups.delete(g.id); history.delete('group:' + g.id);
    syncAll();
    ack?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const id = socket.data.userId, n = (online.get(id) || 1) - 1;
    n <= 0 ? online.delete(id) : online.set(id, n);
    broadcastPresence();
  });
});

server.listen(PORT, () => console.log(`COMSATS Connect running on http://localhost:${PORT}`));
