import type { ProviderConnection } from '../../../shared/types.js';

export interface RenderWorkspaceRef {
  id: string;
  name: string;
  email?: string;
  type?: string;
}

export function getRenderWorkspaces(connection: ProviderConnection): RenderWorkspaceRef[] {
  if (connection.provider !== 'render') return [];
  const raw = Array.isArray(connection.metadata?.workspaces) ? connection.metadata?.workspaces : [];
  return raw
    .map((item: any) => ({ id: item?.id, name: item?.name || item?.email || item?.id, email: item?.email, type: item?.type }))
    .filter((item: any): item is RenderWorkspaceRef => typeof item.id === 'string' && item.id.length > 0);
}

export function resolveRenderWorkspace(connection: ProviderConnection, requestedId?: string): RenderWorkspaceRef {
  if (connection.provider !== 'render') throw new Error('Render provider connection is required.');
  const workspaces = getRenderWorkspaces(connection);
  if (requestedId) {
    const found = workspaces.find((item) => item.id === requestedId);
    if (!found) throw new Error(`Render workspace ${requestedId} is not available to the selected Render API key.`);
    return found;
  }
  if (workspaces.length === 1) return workspaces[0];
  if (workspaces.length > 1) throw new Error('Multiple Render workspaces are available. Select the exact workspace ID.');
  throw new Error('No Render workspaces were discovered for this API key. Re-check the Render connection.');
}

export function renderWorkspaceOwns(connection: ProviderConnection, ownerId?: string): boolean {
  if (!ownerId) return false;
  return getRenderWorkspaces(connection).some((workspace) => workspace.id === ownerId);
}

export function renderWorkspaceById(connection: ProviderConnection, ownerId?: string): RenderWorkspaceRef | undefined {
  if (!ownerId) return undefined;
  return getRenderWorkspaces(connection).find((workspace) => workspace.id === ownerId);
}
