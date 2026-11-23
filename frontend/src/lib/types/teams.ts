// People and sharing: organizations, teams, the people a mention offers, shares of an item.

// A person the @-mention picker offers; without access to the place they are shown greyed out
export interface MentionCandidate {
  id: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  hasAccess: boolean;
}

// Defined by server admins and user managers; a person can belong to several
export interface Organization {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface Team {
  id: string;
  orgId?: string;
  name: string;
  description: string;
  members?: TeamMember[];
  createdAt: string;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface UnifiedShare {
  id: string;
  targetType: 'team' | 'user';
  targetId: string;
  targetName?: string;
  targetEmail?: string;
  avatarUrl?: string;
  permission?: 'editor' | 'viewer';
  role?: string;
  createdBy?: string;
  createdAt: string;
}
