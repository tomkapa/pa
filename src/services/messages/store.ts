import type { Message } from '../../types/message.js'

type Listener = () => void

export interface ConversationStore {
  getMessages(): Message[]
  append(message: Message): void
  setMessages(messagesOrUpdater: Message[] | ((prev: Message[]) => Message[])): void
  clear(): void
  findByUUID(uuid: string): Message | undefined
  subscribe(listener: Listener): () => void
}

export function createConversationStore(): ConversationStore {
  let messages: Message[] = []
  const listeners = new Set<Listener>()

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    getMessages(): Message[] {
      return [...messages]
    },

    append(message: Message): void {
      messages.push(message)
      notify()
    },

    setMessages(messagesOrUpdater: Message[] | ((prev: Message[]) => Message[])): void {
      const next = typeof messagesOrUpdater === 'function'
        ? messagesOrUpdater(messages)
        : messagesOrUpdater
      if (next === messages) return
      messages = next
      notify()
    },

    clear(): void {
      messages = []
      notify()
    },

    findByUUID(uuid: string): Message | undefined {
      return messages.find(m => m.uuid === uuid)
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
