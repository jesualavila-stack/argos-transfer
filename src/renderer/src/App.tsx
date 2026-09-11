import { useEffect, useMemo, useState } from 'react'
import type { AppState } from '../../shared/types'

const emptyState: AppState = {
  me: { id: '', name: '', pin: '', port: 0, fingerprint: '' },
  peers: [],
  receiveDir: '',
  transfer: null,
  dockEnabled: true,
  sendToInstalled: false,
  packaged: false,
  queuedCount: 0,
  sendOnly: false,
  lastError: null,
  statusText: 'Iniciando…'
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return '0 MB/s'
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>(emptyState)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedPeer, setSelectedPeer] = useState<string>('')
  const [queued, setQueued] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [manualHost, setManualHost] = useState('')
  const [busy, setBusy] = useState(false)
  const [sendToMessage, setSendToMessage] = useState('')

  useEffect(() => {
    void window.argos.getState().then((next) => {
      setState(next)
      setName(next.me.name)
      setPin(next.me.pin)
      if (!selectedPeer && next.peers[0]) setSelectedPeer(next.peers[0].id)
    })
    return window.argos.onState((next) => {
      setState(next)
      setSelectedPeer((current) => current || next.peers[0]?.id || '')
    })
  }, [selectedPeer])

  const target = useMemo(
    () => state.peers.find((peer) => peer.id === selectedPeer) ?? state.peers[0],
    [selectedPeer, state.peers]
  )

  const pathsFromDrop = (event: React.DragEvent): string[] => {
    return [...event.dataTransfer.files]
      .map((file) => window.argos.getPathForFile(file))
      .filter(Boolean)
  }

  const send = async (paths = queued): Promise<void> => {
    const toSend = paths.length > 0 ? paths : await window.argos.pickFiles()
    if (toSend.length === 0) return
    setBusy(true)
    try {
      await window.argos.sendFiles(target?.id, toSend)
      setQueued([])
    } catch {
      // el error viaja en state.lastError
    } finally {
      setBusy(false)
    }
  }

  const progress = state.transfer
    ? Math.min(
        100,
        Math.round((state.transfer.transferred / Math.max(1, state.transfer.total)) * 100)
      )
    : 0

  return (
    <main className="app">
      <header className="brand">
        <div className="logo">
          <div className="mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M7 17 3 12l4-5M17 7l4 5-4 5M14 4l-4 16"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <h1>ARGOS TRANSFER</h1>
            <p>LAN · portable · sin admin</p>
          </div>
        </div>
        <button className="icon-btn" onClick={() => setSettingsOpen((value) => !value)}>
          ⚙
        </button>
      </header>

      <section className="card peers">
        {state.peers.length === 0 ? (
          <div className="empty">
            <p>
              En la notebook no aceptes el firewall: pide admin y no hace falta. Esta PC casa sí
              puede recibirlo.
            </p>
            <label>
              IP de la PC Casa
              <div className="row">
                <input
                  placeholder="192.168.1.12"
                  value={manualHost}
                  onChange={(event) => setManualHost(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && manualHost.trim()) {
                      void window.argos.connectManual(manualHost.trim())
                    }
                  }}
                />
                <button
                  className="ghost"
                  onClick={() => {
                    if (manualHost.trim()) void window.argos.connectManual(manualHost.trim())
                  }}
                >
                  Conectar
                </button>
              </div>
            </label>
          </div>
        ) : (
          state.peers.map((peer) => (
            <button
              key={peer.id}
              className={`peer ${target?.id === peer.id ? 'active' : ''}`}
              onClick={() => setSelectedPeer(peer.id)}
            >
              <div className="peer-main">
                <span className="dot" />
                <div>
                  <strong>{peer.name}</strong>
                  <span>
                    {peer.host}:{peer.port}
                    {peer.trusted ? ' · de confianza' : ''}
                  </span>
                </div>
              </div>
              <span>Conectada</span>
            </button>
          ))
        )}
      </section>

      {settingsOpen ? (
        <section className="card settings">
          <div className="toggle">
            <span>Solo enviar · notebook corporativa (no abre puertos ni pide firewall)</span>
            <input
              type="checkbox"
              checked={state.sendOnly}
              onChange={(event) => void window.argos.setSendOnly(event.target.checked)}
            />
          </div>
          <label>
            Nombre de esta máquina
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button className="ghost" onClick={() => void window.argos.setName(name)}>
            Guardar nombre
          </button>
          <label>
            PIN compartido (el mismo en notebook y PC)
            <div className="row">
              <input value={pin} onChange={(event) => setPin(event.target.value)} />
              <button className="ghost" onClick={() => void window.argos.setPin(pin)}>
                Usar
              </button>
              <button
                className="ghost"
                onClick={async () => {
                  const next = await window.argos.regeneratePin()
                  setPin(next)
                }}
              >
                Nuevo
              </button>
            </div>
          </label>
          <label>
            Carpeta de llegada
            <span>{state.receiveDir}</span>
          </label>
          <button className="ghost" onClick={() => void window.argos.setReceiveDir()}>
            Cambiar carpeta
          </button>
          <label>
            Conectar por IP
            <div className="row">
              <input
                placeholder="192.168.0.25"
                value={manualHost}
                onChange={(event) => setManualHost(event.target.value)}
              />
              <button
                className="ghost"
                onClick={() => {
                  if (manualHost.trim()) void window.argos.connectManual(manualHost.trim())
                }}
              >
                Conectar
              </button>
            </div>
          </label>
          <div className="toggle">
            <span>Zona de lanzamiento en el borde</span>
            <input
              type="checkbox"
              checked={state.dockEnabled}
              onChange={(event) => void window.argos.toggleDock(event.target.checked)}
            />
          </div>
          <button
            className="ghost"
            onClick={async () => {
              const result = await window.argos.installSendTo(target?.name || 'PC Casa')
              setSendToMessage(result.ok ? `Listo: ${result.path}` : result.message || 'No se pudo')
            }}
          >
            Agregar Enviar a → {target?.name || 'PC Casa'}
          </button>
          {sendToMessage ? <p className="hint">{sendToMessage}</p> : null}
        </section>
      ) : (
        <>
          <section
            className={`card drop ${over ? 'over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setOver(false)
              const paths = pathsFromDrop(event)
              setQueued(paths)
              if (target && paths.length > 0) void send(paths)
            }}
          >
            <div className="arrow">↓</div>
            <h2>Arrastrá archivos aquí</h2>
            <p className="hint">
              {queued.length > 0
                ? `${queued.length} archivo${queued.length === 1 ? '' : 's'} listo${queued.length === 1 ? '' : 's'}`
                : 'o hacé clic en enviar y elegilos'}
            </p>
          </section>

          <button
            className="primary"
            disabled={busy || (!target && queued.length === 0)}
            onClick={() => void send()}
          >
            {target ? `Enviar a ${target.name}` : 'Enviar'}
          </button>

          {progress > 0 && state.transfer ? (
            <>
              <div className="progress">
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="meta">
                <span>
                  {state.transfer.fileName} · {formatBytes(state.transfer.transferred)} /{' '}
                  {formatBytes(state.transfer.total)}
                </span>
                <span className="speed">{formatSpeed(state.transfer.bytesPerSec)}</span>
              </div>
            </>
          ) : (
            <div className="meta">
              <span>Transferencia directa · {state.statusText}</span>
              <span className="speed">
                LAN · Cifrada
                {state.transfer ? ` · ${formatSpeed(state.transfer.bytesPerSec)}` : ''}
              </span>
            </div>
          )}
        </>
      )}

      {state.lastError ? <p className="error">{state.lastError}</p> : null}
    </main>
  )
}
