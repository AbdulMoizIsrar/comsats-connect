// ---------------------------------------------------------------
// COMMUNICATION BOUNDARIES  (single source of truth for all rules)
// Every Socket.IO event on the server calls these before acting.
// ---------------------------------------------------------------
const { ROLES, groups } = require('./data');

const isAdmin = u => u.role === 'admin';

/** Is this person ELIGIBLE to be a member? (role + department boundary) */
function canBeMember(user, group) {
  if (!group.allowedRoles.includes(user.role)) return false;
  if (group.dept && user.dept !== group.dept && !isAdmin(user)) return false;
  return true;
}

/** Can the person read this group? */
const hasAccess = (user, g) => isAdmin(user) || g.members.has(user.id);

/** Can the person write in this group? (read-only announcement channels, muted users) */
function canPost(user, g) {
  if (!hasAccess(user, g)) return false;
  if (g.muted.has(user.id)) return false;
  return isAdmin(user) || g.ownerId === user.id || g.postRoles.includes(user.role);
}

/** Can the person add/remove members, mute, delete the group? */
function canManage(user, g) {
  return isAdmin(user) || g.ownerId === user.id || (user.role === 'hod' && g.dept === user.dept);
}

// A "real" relationship = a shared course / society / discussion / faculty group.
// Broadcast channels (announcements) and university-wide auto-enrolled groups don't count,
// otherwise everyone would share a group with everyone.
const sharesGroup = (a, b) =>
  [...groups.values()].some(g =>
    g.type !== 'announcement' && !g.autoEnroll && g.members.has(a.id) && g.members.has(b.id));

/**
 * Direct-message boundaries
 *  - Admin office  <-> everyone
 *  - Student       <-> student : same department only
 *  - Student       <-> faculty/HoD/staff : only if they share a group (course, dept...)
 *  - Faculty/HoD/staff <-> each other : always
 */
function canDM(a, b) {
  if (a.id === b.id) return false;
  if (isAdmin(a) || isAdmin(b)) return true;
  if (a.role === 'student' && b.role === 'student') return a.dept === b.dept;
  if (a.role === 'student' || b.role === 'student') return sharesGroup(a, b);
  return true;
}

/** Who may create which kind of group? Returns error string or null. Mutates spec (forces dept/roles). */
function validateCreate(user, spec) {
  const TYPES = ['announcement', 'course', 'discussion', 'faculty', 'society'];
  if (!spec.name || spec.name.trim().length < 3 || spec.name.length > 60) return 'Group name must be 3–60 characters.';
  if (!TYPES.includes(spec.type)) return 'Unknown group type.';
  if (!Array.isArray(spec.allowedRoles) || !spec.allowedRoles.length) return 'Pick at least one role allowed to join.';
  if (!Array.isArray(spec.postRoles)) spec.postRoles = [];
  if (![...spec.allowedRoles, ...spec.postRoles].every(r => ROLES.includes(r))) return 'Invalid role.';

  if (isAdmin(user)) return null;

  if (user.role === 'hod') {               // HoD: only within own department
    spec.dept = user.dept;
    return null;
  }
  if (user.role === 'faculty') {           // Faculty: course / discussion groups for own dept students & colleagues
    if (!['course', 'discussion'].includes(spec.type)) return 'Faculty can only create course or discussion groups.';
    spec.dept = user.dept;
    spec.allowedRoles = ['faculty', 'student'];
    return null;
  }
  return 'Your role is not permitted to create groups.';
}

module.exports = { canBeMember, hasAccess, canPost, canManage, canDM, validateCreate, sharesGroup, isAdmin };
