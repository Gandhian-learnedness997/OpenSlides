import { SlideInfo, VersionState, LoadedContent, ChatMessage } from '@/types';

export const getSlideInfo = async (projectId: string): Promise<SlideInfo | null> => {
  try {
    const res = await fetch(`/api/projects/${projectId}/info`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("Error fetching slide info:", error);
    return null;
  }
};

export const saveSlideInfo = async (projectId: string, info: SlideInfo): Promise<void> => {
  await fetch(`/api/projects/${projectId}/info`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(info),
  });
};

export const saveState = async (
  projectId: string,
  stateIndex: number,
  htmlContent: string,
  chatHistory: ChatMessage[] | null,
  isAuto: boolean = false
): Promise<VersionState> => {
  const stateId = `${isAuto ? 'auto' : 'state'}_${stateIndex}`;

  await fetch(`/api/projects/${projectId}/states`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stateId,
      html: htmlContent,
      chat: chatHistory || [],
    }),
  });

  return {
    id: stateId,
    name: isAuto ? `Auto Save ${stateIndex}` : `State ${stateIndex}`,
    path: stateId,
    chat_path: stateId,
    save_time: new Date().toISOString(),
    is_auto: isAuto,
  };
};

export const deleteState = async (projectId: string, stateId: string): Promise<void> => {
  await fetch(`/api/projects/${projectId}/states/${stateId}`, { method: 'DELETE' });
};

export const loadStateContent = async (projectId: string, stateId: string): Promise<LoadedContent> => {
  const res = await fetch(`/api/projects/${projectId}/states/${stateId}`);
  if (!res.ok) throw new Error(`State not found: ${stateId}`);
  const data = await res.json();
  return {
    html: data.html || '',
    chat: data.chat || [],
  };
};

export const deleteProjectData = async (projectId: string): Promise<void> => {
  await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
};
