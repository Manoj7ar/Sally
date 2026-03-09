// Type-safe IPC wrapper for renderer process
import type {
  IpcChannels,
  IpcRequest,
  IpcResponse,
  IpcBroadcast,
} from '../../shared/types';

// Check if running in Electron
export const isElectron = typeof window !== 'undefined' && window.electron !== undefined;

// Type-safe invoke
export async function invoke<T extends keyof IpcChannels>(
  channel: T,
  ...args: IpcRequest<T> extends void ? [] : [IpcRequest<T>]
): Promise<IpcResponse<T>> {
  if (!isElectron) {
    console.warn(`IPC not available (not in Electron): ${channel}`);
    throw new Error('Not running in Electron');
  }
  return window.electron.invoke(channel, args[0]);
}

// Type-safe send (fire-and-forget)
export function send<T extends keyof IpcChannels>(
  channel: T,
  ...args: IpcRequest<T> extends void ? [] : [IpcRequest<T>]
): void {
  if (!isElectron) {
    console.warn(`IPC not available (not in Electron): ${channel}`);
    return;
  }
  window.electron.send(channel, args[0]);
}

// Type-safe subscribe to broadcasts
export function subscribe<T extends keyof IpcChannels>(
  channel: T,
  callback: (data: IpcBroadcast<T>) => void
): () => void {
  if (!isElectron) {
    console.warn(`IPC not available (not in Electron): ${channel}`);
    return () => {};
  }
  return window.electron.on(channel, (_event, data) => {
    callback(data as IpcBroadcast<T>);
  });
}

// Get platform
export function getPlatform(): NodeJS.Platform {
  if (!isElectron) return 'darwin';
  return window.electron.platform;
}

export const ipc = {
  invoke,
  send,
  subscribe,
  isElectron,
  getPlatform,
};
