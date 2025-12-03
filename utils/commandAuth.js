import { PermissionFlagsBits } from 'discord.js';

/**
 * Check if an interaction user is authorized to run a command.
 * - OWNER_IDS (env) can contain comma-separated user IDs (global owners).
 * - allowGuildAdmins -> permit users with ManageGuild or Administrator.
 * - allowedRoleEnvVar -> name of env var that holds comma-separated role IDs allowed for this command.
 *
 * Usage:
 * if (!await isAuthorizedForCommand(interaction, { allowedRoleEnvVar: 'FORCERUNWEEKLY_ROLE_IDS' })) { ... }
 */
export async function isAuthorizedForCommand(interaction, {
  allowedRoleEnvVar = null,
  allowGuildAdmins = true,
  ownerEnvVar = 'OWNER_IDS'
} = {}) {
  if (!interaction) return false;

  // owners
  const ownerIds = (process.env[ownerEnvVar] || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ownerIds.includes(interaction.user?.id)) return true;

  // guild admin check (if in guild)
  if (allowGuildAdmins && interaction.inGuild()) {
    try {
      if (interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator) ||
          interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild)) {
        return true;
      }
    } catch (e) { /* ignore */ }
  }

  // role-based check: try cached roles, otherwise fetch member to get roles
  if (allowedRoleEnvVar && interaction.inGuild()) {
    const allowed = (process.env[allowedRoleEnvVar] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length) {
      let member = interaction.member;
      let rolesCache = member?.roles?.cache;

      if (!rolesCache) {
        try {
          member = await interaction.guild.members.fetch(interaction.user.id);
          rolesCache = member?.roles?.cache;
        } catch (e) {
          // fetching failed; we'll fallback to other checks below
        }
      }

      if (rolesCache) {
        for (const rId of allowed) {
          if (rolesCache.has(rId)) return true;
        }
      } else if (Array.isArray(member?.roles)) {
        for (const rId of allowed) {
          if (member.roles.includes(rId)) return true;
        }
      }
    }
  }

  return false;
}