// ---------------------------------------------------------------
// In-memory data store + seed data for COMSATS University Islamabad
// (Swap this for MongoDB/MySQL in a real deployment.)
// ---------------------------------------------------------------

const ROLES = ['admin', 'hod', 'faculty', 'student', 'staff'];
const DEPTS = ['CS', 'EE', 'SE', 'MGT', 'ADMIN'];

const users = new Map();   // id -> user
const groups = new Map();  // id -> group
const history = new Map(); // room -> [messages]

let gSeq = 0;
const nextGroupId = () => 'g' + (++gSeq);

function addUser({ id, name, role, dept, password }) {
  users.set(id, { id, name, role, dept, password });
}

function addGroup({ name, type, dept = null, ownerId = null, allowedRoles, postRoles, members = [], autoEnroll = false }) {
  const id = nextGroupId();
  const g = { id, name, type, dept, ownerId, allowedRoles, postRoles, autoEnroll, members: new Set(members), muted: new Set() };
  groups.set(id, g);
  history.set('group:' + id, []);
  return g;
}

// ---------- Seed users (password = "123" for all demo accounts) ----------
[
  { id: 'ADM-001',        name: 'Registrar Office',        role: 'admin',   dept: 'ADMIN' },
  { id: 'EMP-100',        name: 'Dr. Ahmed Raza (HoD CS)', role: 'hod',     dept: 'CS' },
  { id: 'EMP-110',        name: 'Dr. Nadia Khan (HoD EE)', role: 'hod',     dept: 'EE' },
  { id: 'EMP-201',        name: 'Dr. Sana Malik',          role: 'faculty', dept: 'CS' },
  { id: 'EMP-202',        name: 'Mr. Usman Tariq',         role: 'faculty', dept: 'CS' },
  { id: 'EMP-301',        name: 'Dr. Bilal Hussain',       role: 'faculty', dept: 'EE' },
  { id: 'FA23-BCS-001',   name: 'Ali Hassan',              role: 'student', dept: 'CS' },
  { id: 'FA23-BCS-002',   name: 'Fatima Noor',             role: 'student', dept: 'CS' },
  { id: 'FA23-BCS-003',   name: 'Hamza Yousaf',            role: 'student', dept: 'CS' },
  { id: 'FA23-BEE-001',   name: 'Zainab Iqbal',            role: 'student', dept: 'EE' },
  { id: 'SP24-BSE-001',   name: 'Omar Farooq',             role: 'student', dept: 'SE' },
  { id: 'STF-01',         name: 'Transport Office',        role: 'staff',   dept: 'ADMIN' },
  { id: 'STF-02',         name: 'IT Helpdesk',             role: 'staff',   dept: 'ADMIN' },
].forEach(u => addUser({ ...u, password: '123' }));

// ---------- Seed groups ----------
const ALL = ['admin', 'hod', 'faculty', 'student', 'staff'];

addGroup({
  name: 'COMSATS Official Notices', type: 'announcement',
  allowedRoles: ALL, postRoles: ['admin'],
  autoEnroll: true,
  members: [...users.keys()],
});
addGroup({
  name: 'Transport Updates', type: 'announcement',
  allowedRoles: ALL, postRoles: ['admin', 'staff'],
  autoEnroll: true,
  members: [...users.keys()],
});
addGroup({
  name: 'IT Helpdesk Support', type: 'discussion',
  allowedRoles: ALL, postRoles: ALL,
  autoEnroll: true,
  members: [...users.keys()],
});
addGroup({
  name: 'Heads of Departments', type: 'faculty', ownerId: 'ADM-001',
  allowedRoles: ['hod'], postRoles: ['hod'],
  members: ['EMP-100', 'EMP-110'],
});
addGroup({
  name: 'CS Department Notices', type: 'announcement', dept: 'CS', ownerId: 'EMP-100',
  allowedRoles: ['hod', 'faculty', 'student'], postRoles: ['hod'],
  members: ['EMP-100', 'EMP-201', 'EMP-202', 'FA23-BCS-001', 'FA23-BCS-002', 'FA23-BCS-003'],
});
addGroup({
  name: 'CS Faculty Room', type: 'faculty', dept: 'CS', ownerId: 'EMP-100',
  allowedRoles: ['hod', 'faculty'], postRoles: ['hod', 'faculty'],
  members: ['EMP-100', 'EMP-201', 'EMP-202'],
});
addGroup({
  name: 'CS Students Hub', type: 'discussion', dept: 'CS', ownerId: 'EMP-100',
  allowedRoles: ['student'], postRoles: ['student'],
  members: ['FA23-BCS-001', 'FA23-BCS-002', 'FA23-BCS-003'],
});
addGroup({
  name: 'CSC101 Programming Fundamentals (BCS-1A)', type: 'course', dept: 'CS', ownerId: 'EMP-201',
  allowedRoles: ['faculty', 'student'], postRoles: ['faculty', 'student'],
  members: ['EMP-201', 'FA23-BCS-001', 'FA23-BCS-002'],
});
addGroup({
  name: 'CSC210 Data Structures (BCS-3B)', type: 'course', dept: 'CS', ownerId: 'EMP-202',
  allowedRoles: ['faculty', 'student'], postRoles: ['faculty'], // lecture-notes channel: students read-only
  members: ['EMP-202', 'FA23-BCS-002', 'FA23-BCS-003'],
});
addGroup({
  name: 'EE Department Notices', type: 'announcement', dept: 'EE', ownerId: 'EMP-110',
  allowedRoles: ['hod', 'faculty', 'student'], postRoles: ['hod'],
  members: ['EMP-110', 'EMP-301', 'FA23-BEE-001'],
});
addGroup({
  name: 'Software Engineering Society', type: 'society', ownerId: 'ADM-001',
  allowedRoles: ['student', 'faculty'], postRoles: ['student', 'faculty'],
  members: ['FA23-BCS-001', 'SP24-BSE-001', 'EMP-202'],
});

module.exports = { ROLES, DEPTS, users, groups, history, addUser, addGroup };
