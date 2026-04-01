const CHAT_MODE_TO_SETTING = {
  open: 'not_announcement',
  close: 'announcement'
};

export async function updateGroupParticipants(client, groupJid, participantJids, action) {
  return client.groupParticipantsUpdate(groupJid, participantJids, action);
}

export async function addGroupParticipant(client, groupJid, participantJid) {
  return updateGroupParticipants(client, groupJid, [participantJid], 'add');
}

export async function removeGroupParticipant(client, groupJid, participantJid) {
  return updateGroupParticipants(client, groupJid, [participantJid], 'remove');
}

export async function promoteGroupParticipant(client, groupJid, participantJid) {
  return updateGroupParticipants(client, groupJid, [participantJid], 'promote');
}

export async function demoteGroupParticipant(client, groupJid, participantJid) {
  return updateGroupParticipants(client, groupJid, [participantJid], 'demote');
}

export async function setGroupChatMode(client, groupJid, mode) {
  const setting = CHAT_MODE_TO_SETTING[mode];
  if (!setting) {
    throw new Error(`Unsupported group chat mode: ${mode}`);
  }

  return client.groupSettingUpdate(groupJid, setting);
}

export async function getGroupInviteLink(client, groupJid) {
  const code = await client.groupInviteCode(groupJid);
  return `https://chat.whatsapp.com/${code}`;
}

export async function setGroupEphemeralDuration(client, groupJid, duration) {
  return client.groupToggleEphemeral(groupJid, duration);
}

export async function listGroupJoinRequests(client, groupJid) {
  return client.groupRequestParticipantsList(groupJid);
}

export async function updateGroupJoinRequests(client, groupJid, participantJids, action) {
  return client.groupRequestParticipantsUpdate(groupJid, participantJids, action);
}

export async function approveGroupJoinRequests(client, groupJid, participantJids) {
  return updateGroupJoinRequests(client, groupJid, participantJids, 'approve');
}

export async function rejectGroupJoinRequests(client, groupJid, participantJids) {
  return updateGroupJoinRequests(client, groupJid, participantJids, 'reject');
}

export async function setGroupJoinApprovalMode(client, groupJid, enabled) {
  return client.groupJoinApprovalMode(groupJid, enabled ? 'on' : 'off');
}
