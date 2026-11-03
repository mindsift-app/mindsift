// REST calls: Groups (user-managed teams)
import { Team } from '../types';
import { ensureArray, request } from './client';

export const teamsApi = {
  // --- GROUPS (user-managed) ---
  async createTeam(name: string, description = ''): Promise<Team> {
    return request<Team>('/api/v1/teams', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  },

  async updateTeam(teamId: string, name: string, description = ''): Promise<Team> {
    return request<Team>(`/api/v1/teams/${teamId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, description }),
    });
  },

  async deleteTeam(teamId: string): Promise<void> {
    await request(`/api/v1/teams/${teamId}`, { method: 'DELETE' });
  },

  async getUserTeams(): Promise<Team[]> {
    const res = await request<Team[]>('/api/v1/teams');
    return ensureArray(res).map((t) => ({ ...t, members: ensureArray(t.members) }));
  },

  async addTeamMember(
    teamId: string,
    payload: { userId?: string; email?: string; role: string }
  ): Promise<void> {
    await request(`/api/v1/teams/${teamId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateTeamMemberRole(
    teamId: string,
    userId: string,
    role: 'admin' | 'member'
  ): Promise<void> {
    await request(`/api/v1/teams/${teamId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  },

  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await request(`/api/v1/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
  },
};
