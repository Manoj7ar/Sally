// Preload script - exposes IPC bridge to renderer
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Increase max listeners to avoid warnings during development with HMR
ipcRenderer.setMaxListeners(50);

// Type-safe IPC bridge
interface ElectronAPI {
  // Invoke (request-response pattern)
  invoke<T>(channel: string, data?: unknown): Promise<T>;

  // Send (fire-and-forget)
  send(channel: string, data?: unknown): void;

  // Subscribe to broadcasts from main
  on(channel: string, callback: (event: IpcRendererEvent, data: unknown) => void): () => void;

  // One-time listener
  once(channel: string, callback: (event: IpcRendererEvent, data: unknown) => void): void;

  // Remove all listeners for a channel
  removeAllListeners(channel: string): void;

  // Platform info
  platform: NodeJS.Platform;
}

const electronAPI: ElectronAPI = {
  invoke: <T>(channel: string, data?: unknown): Promise<T> => {
    return ipcRenderer.invoke(channel, data);
  },

  send: (channel: string, data?: unknown): void => {
    ipcRenderer.send(channel, data);
  },

  on: (channel: string, callback: (event: IpcRendererEvent, data: unknown) => void): (() => void) => {
    ipcRenderer.on(channel, callback);
    return () => {
      ipcRenderer.removeListener(channel, callback);
    };
  },

  once: (channel: string, callback: (event: IpcRendererEvent, data: unknown) => void): void => {
    ipcRenderer.once(channel, callback);
  },

  removeAllListeners: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },

  platform: process.platform,
};

// Expose to renderer
contextBridge.exposeInMainWorld('electron', electronAPI);

// Log successful preload
console.log('Preload script loaded');
