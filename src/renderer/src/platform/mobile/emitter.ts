// 简单的 IPC 事件发射器，模拟 Electron ipcRenderer 的 on/once/removeListener 语义
export type IpcListener = (event: unknown, ...args: unknown[]) => void

const listeners = new Map<string, Set<IpcListener>>()
const onceListeners = new Map<string, Set<IpcListener>>()

export function addListener(channel: string, listener: IpcListener): void {
  if (!listeners.has(channel)) listeners.set(channel, new Set())
  listeners.get(channel)!.add(listener)
}

export function addOnceListener(channel: string, listener: IpcListener): void {
  if (!onceListeners.has(channel)) onceListeners.set(channel, new Set())
  onceListeners.get(channel)!.add(listener)
}

export function removeListener(channel: string, listener: IpcListener): void {
  listeners.get(channel)?.delete(listener)
  onceListeners.get(channel)?.delete(listener)
}

export function removeAllListeners(channel: string): void {
  listeners.delete(channel)
  onceListeners.delete(channel)
}

export function emitChannel(channel: string, ...args: unknown[]): void {
  const regular = listeners.get(channel)
  if (regular) {
    for (const l of [...regular]) l({}, ...args)
  }
  const once = onceListeners.get(channel)
  if (once) {
    for (const l of [...once]) l({}, ...args)
    onceListeners.delete(channel)
  }
}
