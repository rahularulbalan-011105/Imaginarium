import Peer from 'peerjs'
import { useGameStore } from '../stores/gameStore.js'

// WebRTC peer-to-peer transport for online battles, using PeerJS's free public
// signalling broker. One player hosts (gets a room code), the other joins with
// it; after that they're connected directly. `onData` routes game messages to
// BattleManager. No custom server required.

const PREFIX = 'atumx-'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   // no ambiguous chars

// STUN + free public TURN (Open Relay). TURN relays media when a direct P2P
// path is blocked by NAT/firewalls — without it, many home/mobile networks
// can't connect at all.
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
}
const CONNECT_TIMEOUT_MS = 14000

function makeCode() {
  let s = ''
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return s
}

class NetworkManager {
  constructor() {
    this.peer = null
    this.conn = null
    this.role = null
    this.onData = null     // (msg) => void
    this.onReady = null    // () => void  (connection open)
    this.onClose = null
    this._timer = null
  }

  _set(p) { useGameStore.getState().sync(p) }
  _clearTimer() { if (this._timer) { clearTimeout(this._timer); this._timer = null } }

  host() {
    this.disconnect()
    this.role = 'host'
    const code = makeCode()
    this._set({ role: 'host', connState: 'waiting', roomCode: code, netError: '' })
    this.peer = new Peer(PREFIX + code, { config: ICE, debug: 1 })
    this.peer.on('open', () => this._set({ connState: 'waiting' }))
    this.peer.on('connection', (conn) => this._bind(conn))
    // The free broker drops idle peers; re-register so the room code stays alive.
    this.peer.on('disconnected', () => {
      console.warn('[net] host disconnected from broker — reconnecting')
      try { this.peer.reconnect() } catch (_) {}
    })
    this.peer.on('error', (e) => {
      console.error('[net] host peer error', e)
      this._set({ connState: 'error', netError: e?.type || String(e) })
    })
    return code
  }

  join(code) {
    this.disconnect()
    this.role = 'guest'
    const clean = String(code || '').trim().toUpperCase()
    this._set({ role: 'guest', connState: 'connecting', roomCode: clean, netError: '' })
    this._joinTarget = PREFIX + clean
    this._joinTries = 0
    this.peer = new Peer(undefined, { config: ICE, debug: 1 })
    this.peer.on('open', () => this._attemptConnect())
    this.peer.on('disconnected', () => { try { this.peer.reconnect() } catch (_) {} })
    this.peer.on('error', (e) => {
      console.error('[net] guest peer error', e)
      // peer-unavailable can be transient (host still re-registering) — retry a few times
      if (e?.type === 'peer-unavailable' && this._joinTries < 4) {
        console.warn('[net] host not found yet — retrying', this._joinTries)
        this._clearTimer()
        this._timer = setTimeout(() => this._attemptConnect(), 1500)
        return
      }
      const msg = e?.type === 'peer-unavailable'
        ? 'no host with that code — make sure the host screen still shows the code and retry'
        : (e?.type || String(e))
      this._set({ connState: 'error', netError: msg })
    })
  }

  _attemptConnect() {
    if (!this.peer || this.peer.destroyed) return
    this._joinTries++
    const conn = this.peer.connect(this._joinTarget, { reliable: true })
    this._bind(conn)
    this._clearTimer()
    this._timer = setTimeout(() => {
      if (useGameStore.getState().connState !== 'connected') {
        if (this._joinTries < 4) { console.warn('[net] connect attempt timed out — retrying'); this._attemptConnect() }
        else {
          console.error('[net] connect failed after retries')
          this._set({ connState: 'error', netError: 'could not reach host. Check the code, that the host is still on the waiting screen, and retry.' })
          try { conn.close() } catch (_) {}
        }
      }
    }, CONNECT_TIMEOUT_MS)
  }

  _bind(conn) {
    this.conn = conn
    conn.on('open', () => {
      this._clearTimer()
      console.log('[net] connection open')
      this._set({ connState: 'connected' })
      this.onReady && this.onReady()
    })
    conn.on('data', (d) => { this.onData && this.onData(d) })
    conn.on('close', () => { this._set({ connState: 'closed' }); this.onClose && this.onClose() })
    conn.on('error', (e) => { console.error('[net] conn error', e); this._set({ connState: 'error', netError: e?.type || String(e) }) })
  }

  send(msg) {
    if (this.conn && this.conn.open) { try { this.conn.send(msg) } catch (_) {} }
  }

  isConnected() { return !!(this.conn && this.conn.open) }

  disconnect() {
    this._clearTimer()
    try { this.conn?.close() } catch (_) {}
    try { this.peer?.destroy() } catch (_) {}
    this.conn = null
    this.peer = null
  }
}

export const networkManager = new NetworkManager()
