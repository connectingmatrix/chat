import { GRAPHQL_API_URL } from '@giga/dataloader/client/legacy/graphql/env';
import { accessTokenHeader, readStoredTokens } from '@giga/dataloader/client/legacy/graphql/helper';
import type { JsonObject, ScopeRef } from '@giga/dataloader/client/legacy/orm/types';

export type UploadedChatAttachment = {
    id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    drive_path: string;
    storage_bucket: string;
    storage_path: string;
    kind: string;
    metadata?: JsonObject | null;
};

const operation = `mutation GigaUiChatAttachmentUpload($input: ChatAttachmentUploadInput!) { chatAttachmentUpload(input: $input) { id file_name mime_type size_bytes drive_path storage_bucket storage_path kind metadata } }`;

export const uploadChatAttachmentToDrive = async (file: File, scope: ScopeRef): Promise<UploadedChatAttachment> => {
    const tokens = readStoredTokens();
    if (!tokens?.accessToken) throw new Error('Missing authentication token for attachment upload.');
    const form = new FormData();
    form.append('operations', JSON.stringify({ query: operation, variables: { input: { file: null, file_name: file.name, mime_type: file.type || 'application/octet-stream', scope_type: scope.kind, scope_id: scope.id } } }));
    form.append('map', JSON.stringify({ '0': ['variables.input.file'] }));
    form.append('0', file, file.name);
    const response = await fetch(GRAPHQL_API_URL, { method: 'POST', headers: { Authorization: accessTokenHeader(tokens) }, body: form });
    const payload = await response.json();
    if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.[0]?.message || `Attachment upload failed with status ${response.status}`);
    return payload.data.chatAttachmentUpload as UploadedChatAttachment;
};
