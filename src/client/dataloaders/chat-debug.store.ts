import { useSyncExternalStore } from 'react';
import type { JsonObject } from '@/orm';

export type ChatDebugStatus = 'started' | 'progress' | 'completed' | 'failed';

export type ChatDebugEvent = {
    id: string;
    requestId: string;
    chatId: string | null;
    stage: string;
    status: ChatDebugStatus;
    message: string;
    timestamp: string;
    meta?: JsonObject;
};

export type ChatDebugTimeline = {
    requestId: string;
    chatId: string | null;
    startedAt: string;
    updatedAt: string;
    lastSentMessage: string | null;
    isCompleted: boolean;
    hasFailed: boolean;
    events: ChatDebugEvent[];
};

export type ChatDebugRoom = {
    roomId: string;
    activeRequestId: string | null;
    lastSentMessage: string | null;
    requests: ChatDebugTimeline[];
};

export type PushChatDebugEvent = {
    requestId: string;
    chatId: string | null;
    stage: string;
    status: ChatDebugStatus;
    message: string;
    timestamp?: string;
    meta?: JsonObject;
};

const rooms = new Map<string, ChatDebugRoom>();
const listeners = new Set<() => void>();

const emptyRoom = (roomId: string): ChatDebugRoom => ({ roomId, activeRequestId: null, lastSentMessage: null, requests: [] });
const ensureRoom = (roomId: string): ChatDebugRoom => {
    const room = rooms.get(roomId) || emptyRoom(roomId);
    if (!rooms.has(roomId)) rooms.set(roomId, room);
    return room;
};
const now = (): string => new Date().toISOString();
const eventId = (): string => `debug_${crypto.randomUUID()}`;
const emit = (): void => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const chatDebugRoomKey = (chatId: string | null | undefined, scopeKey: string): string => (chatId ? `chat:${chatId}` : `scope:${scopeKey}`);

export const readChatDebugRoom = (roomId: string): ChatDebugRoom => ensureRoom(roomId);

export const transferChatDebugRoom = (fromRoomId: string, toRoomId: string): void => {
    if (fromRoomId === toRoomId) return;
    const source = rooms.get(fromRoomId);
    if (!source) return;
    const target = ensureRoom(toRoomId);
    const merged = new Map(target.requests.map((request) => [request.requestId, request]));
    source.requests.forEach((request) => merged.set(request.requestId, merged.get(request.requestId) || request));
    rooms.set(toRoomId, { ...target, activeRequestId: source.activeRequestId || target.activeRequestId, lastSentMessage: source.lastSentMessage || target.lastSentMessage, requests: [...merged.values()] });
    rooms.delete(fromRoomId);
    emit();
};

export const setChatDebugLastMessage = (roomId: string, message: string): void => {
    const room = ensureRoom(roomId);
    rooms.set(roomId, { ...room, lastSentMessage: message, activeRequestId: room.activeRequestId });
    emit();
};

export const pushChatDebugEvent = (roomId: string, input: PushChatDebugEvent): void => {
    const room = ensureRoom(roomId);
    const timestamp = input.timestamp || now();
    const event: ChatDebugEvent = { id: eventId(), requestId: input.requestId, chatId: input.chatId, stage: input.stage, status: input.status, message: input.message, timestamp, meta: input.meta };
    const existing = room.requests.find((request) => request.requestId === input.requestId);
    const timeline: ChatDebugTimeline =
        existing || { requestId: input.requestId, chatId: input.chatId, startedAt: timestamp, updatedAt: timestamp, lastSentMessage: room.lastSentMessage, isCompleted: false, hasFailed: false, events: [] };
    const requests = room.requests.filter((request) => request.requestId !== input.requestId);
    rooms.set(roomId, {
        ...room,
        activeRequestId: input.requestId,
        requests: [...requests, { ...timeline, chatId: input.chatId || timeline.chatId, updatedAt: timestamp, isCompleted: input.status === 'completed' || input.status === 'failed' || timeline.isCompleted, hasFailed: input.status === 'failed' || timeline.hasFailed, events: [...timeline.events, event] }]
    });
    emit();
};

export const useChatDebugRoom = (roomId: string): ChatDebugRoom =>
    useSyncExternalStore(subscribe, () => readChatDebugRoom(roomId), () => readChatDebugRoom(roomId));
