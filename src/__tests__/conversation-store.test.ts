import { describe, test, expect, mock } from 'bun:test'
import type { Message, UserMessage, AssistantMessage } from '../types/message.js'

const MODULE_PATH = '../services/messages/store.js'

function makeUser(content: string): UserMessage {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'text', text: content }] },
  }
}

function makeAssistant(text: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: undefined,
    message: {
      id: `msg_${crypto.randomUUID().slice(0, 8)}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text, citations: null }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: null,
        inference_geo: null,
        server_tool_use: null,
        service_tier: null,
      },
    },
  }
}

describe('createConversationStore', () => {
  test('starts with empty messages', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()

    expect(store.getMessages()).toEqual([])
  })

  test('appends a message', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    const msg = makeUser('hello')

    store.append(msg)

    expect(store.getMessages()).toHaveLength(1)
    expect(store.getMessages()[0]).toBe(msg)
  })

  test('appends multiple messages in order', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    const u = makeUser('hello')
    const a = makeAssistant('hi')

    store.append(u)
    store.append(a)

    expect(store.getMessages()).toEqual([u, a])
  })

  test('setMessages replaces all messages', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    store.append(makeUser('old'))

    const newMsgs = [makeUser('new')]
    store.setMessages(newMsgs)

    expect(store.getMessages()).toEqual(newMsgs)
  })

  test('setMessages with updater function', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    const msg = makeUser('keep')
    store.append(msg)

    const added = makeAssistant('reply')
    store.setMessages((prev: Message[]) => [...prev, added])

    expect(store.getMessages()).toEqual([msg, added])
  })

  test('getMessages returns a defensive copy', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    store.append(makeUser('hello'))

    const msgs = store.getMessages()
    msgs.push(makeUser('mutated'))

    // Original store should be unaffected
    expect(store.getMessages()).toHaveLength(1)
  })

  test('subscribe notifies on append', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    const listener = mock(() => {})

    store.subscribe(listener)
    store.append(makeUser('hello'))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('subscribe notifies on setMessages', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    const listener = mock(() => {})

    store.subscribe(listener)
    store.setMessages([makeUser('replaced')])

    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('unsubscribe stops notifications', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    const listener = mock(() => {})

    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.append(makeUser('hello'))

    expect(listener).toHaveBeenCalledTimes(0)
  })

  test('multiple subscribers all notified', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    const listener1 = mock(() => {})
    const listener2 = mock(() => {})

    store.subscribe(listener1)
    store.subscribe(listener2)
    store.append(makeUser('hello'))

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
  })

  test('clear removes all messages and notifies', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    store.append(makeUser('hello'))
    store.append(makeAssistant('hi'))

    const listener = mock(() => {})
    store.subscribe(listener)

    store.clear()

    expect(store.getMessages()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('findByUUID returns matching message', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    const msg = makeUser('target')
    store.append(makeUser('other'))
    store.append(msg)

    expect(store.findByUUID(msg.uuid)).toBe(msg)
  })

  test('findByUUID returns undefined for no match', async () => {
    const { createConversationStore } = await import(MODULE_PATH)
    const store = createConversationStore()
    store.append(makeUser('hello'))

    expect(store.findByUUID('nonexistent-uuid')).toBeUndefined()
  })
})
