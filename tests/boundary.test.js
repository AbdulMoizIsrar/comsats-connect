// Integration test: starts the server on a spare port, connects real Socket.IO clients
// and checks every communication boundary.   Run with:  npm test
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3111;
const URL = `http://localhost:${PORT}`;
let passed = 0, failed = 0;
const t = (name, ok) => { ok ? passed++ : failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); };

const conn = (id, pw = '123') => new Promise((res, rej) => {
  const s = io(URL, { auth: { id, password: pw }, reconnection: false });
  s.once('state', st => res({ s, st }));
  s.once('connect_error', rej);
});
const emit = (s, ev, d) => new Promise(r => s.emit(ev, d, r));

async function run() {
  try { await conn('FA23-BCS-001', 'wrong'); t('wrong password is rejected', false); } catch { t('wrong password is rejected', true); }

  const stu = await conn('FA23-BCS-001'), stu2 = await conn('FA23-BCS-002');
  const fac = await conn('EMP-201'), adm = await conn('ADM-001'), hod = await conn('EMP-100');
  const gid = n => stu.st.groups.find(g => g.name.includes(n))?.id;
  const facultyRoom = hod.st.groups.find(g => g.name === 'CS Faculty Room').id;

  t('student cannot see the CS Faculty Room', !gid('Faculty Room'));
  t('student cannot see another department\'s notices', !gid('EE Department'));
  let r = await emit(stu.s, 'group:message', { groupId: gid('CS Department Notices'), text: 'hi' });
  t('student blocked from posting in read-only notices', !!r.error);
  r = await emit(stu.s, 'group:message', { groupId: gid('CSC101'), text: 'question sir' });
  t('student can post in a course group', !!r.ok);
  r = await emit(stu.s, 'group:history', facultyRoom);
  t('student cannot read faculty-room history', !!r.error);

  const got = new Promise(res => stu2.s.once('message', res));
  await emit(stu.s, 'group:message', { groupId: gid('CSC101'), text: 'broadcast' });
  t('group message is delivered to another member', (await got).text === 'broadcast');

  r = await emit(stu.s, 'dm:message', { to: 'FA23-BCS-002', text: 'hey' });
  t('same-department student DM allowed', !!r.ok);
  r = await emit(stu.s, 'dm:message', { to: 'FA23-BEE-001', text: 'hey' });
  t('cross-department student DM blocked', !!r.error);
  r = await emit(stu.s, 'dm:message', { to: 'EMP-201', text: 'sir' });
  t('student -> own course teacher DM allowed', !!r.ok);
  r = await emit(stu.s, 'dm:message', { to: 'EMP-301', text: 'sir' });
  t('student -> EE teacher with no shared group blocked', !!r.error);
  r = await emit(stu.s, 'user:create', { id: 'X', name: 'X', password: 'x', role: 'student', dept: 'CS' });
  t('student cannot create users', !!r.error);
  r = await emit(stu.s, 'group:create', { name: 'My group', type: 'discussion', allowedRoles: ['student'], postRoles: ['student'] });
  t('student cannot create groups', !!r.error);

  r = await emit(fac.s, 'group:create', { name: 'CSC310 OS (BCS-5A)', type: 'course', dept: 'EE', allowedRoles: ['admin'], postRoles: ['faculty'], members: ['FA23-BCS-001', 'FA23-BEE-001'] });
  t('faculty can create a course group (dept forced to CS, EE student skipped)', !!r.ok && r.skipped.length === 1);
  r = await emit(fac.s, 'group:create', { name: 'Faculty-only', type: 'faculty', allowedRoles: ['faculty'], postRoles: ['faculty'] });
  t('faculty cannot create a faculty-type group', !!r.error);
  r = await emit(hod.s, 'group:addMember', { groupId: gid('CS Students'), userId: 'EMP-201' });
  t('HoD cannot add faculty to a students-only group', !!r.error);
  r = await emit(hod.s, 'group:addMember', { groupId: gid('CS Students'), userId: 'FA23-BEE-001' });
  t('HoD cannot add an EE student to a CS group', !!r.error);
  await emit(fac.s, 'group:toggleMute', { groupId: gid('CSC101'), userId: 'FA23-BCS-001' });
  r = await emit(stu.s, 'group:message', { groupId: gid('CSC101'), text: 'muted?' });
  t('muted student cannot post', !!r.error);
  r = await emit(adm.s, 'user:create', { id: 'FA24-BCS-010', name: 'New Student', password: '1', role: 'student', dept: 'CS' });
  t('admin can add a user', !!r.ok);
  const nu = await conn('FA24-BCS-010', '1');
  t('new user is auto-enrolled in official notices', nu.st.groups.some(g => g.name === 'COMSATS Official Notices'));
}

const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT } });
let started = false;
srv.stdout.on('data', async d => {
  if (started || !String(d).includes('running')) return;
  started = true;
  try { await run(); } catch (e) { console.error(e); failed++; }
  console.log(`\n${passed} passed, ${failed} failed`);
  srv.kill();
  process.exit(failed ? 1 : 0);
});
srv.stderr.on('data', d => process.stderr.write(d));
setTimeout(() => { console.error('Server did not start'); srv.kill(); process.exit(1); }, 15000);
