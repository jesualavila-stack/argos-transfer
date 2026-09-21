import { useMemo, useState } from 'react'
import type { AppState, InboxItem } from '../../shared/types'

type Props = {
  state: AppState
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(mtime: number): string {
  const d = new Date(mtime)
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function InboxBoard({ state }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const items = useMemo(() => state.inbox || [], [state.inbox])
  const current = items.find((item) => item.path === selected) || items[0]

  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.argos.refreshInbox()
    } finally {
      setBusy(false)
    }
  }

  const copyPath = async (item: InboxItem): Promise<void> => {
    await window.argos.clipboardWrite(item.path)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <section className="card inbox">
      <div className="inbox-head">
        <div>
          <h2>Recibidos</h2>
          <p className="hint">
            Arrastrá un archivo hacia el Escritorio o cualquier carpeta · clic para seleccionar
          </p>
        </div>
        <button className="ghost" type="button" disabled={busy} onClick={() => void refresh()}>
          Actualizar
        </button>
      </div>

      <div className="inbox-list">
        {items.length === 0 ? (
          <p className="inbox-empty">Todavía no hay archivos. Cuando lleguen, aparecen acá.</p>
        ) : (
          items.map((item) => {
            const active = (current?.path || '') === item.path
            return (
              <div
                key={item.path}
                className={`inbox-item ${active ? 'active' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.preventDefault()
                  window.argos.startDrag(item.path)
                }}
                onClick={() => setSelected(item.path)}
              >
                <div className="inbox-item-main">
                  <strong title={item.relativePath}>{item.name}</strong>
                  <span>
                    {formatBytes(item.size)} · {formatWhen(item.mtime)}
                  </span>
                </div>
                <span className="inbox-drag-hint">⟷</span>
              </div>
            )
          })
        )}
      </div>

      <div className="inbox-actions">
        <button className="ghost" type="button" onClick={() => void window.argos.openReceiveDir()}>
          Abrir carpeta
        </button>
        <button
          className="ghost"
          type="button"
          disabled={!current}
          onClick={() => current && void copyPath(current)}
        >
          {copied ? 'Ruta copiada' : 'Copiar ruta'}
        </button>
        <button
          className="ghost"
          type="button"
          disabled={!current}
          onClick={() => current && void window.argos.revealInboxItem(current.path)}
        >
          Ver en Explorador
        </button>
        <button
          className="primary"
          type="button"
          disabled={!current}
          onClick={() => current && void window.argos.openInboxItem(current.path)}
        >
          Abrir
        </button>
      </div>
    </section>
  )
}
