import { useEffect, useRef, useState } from 'react'
import type { AppState, LiveNote } from '../../shared/types'

type Props = {
  state: AppState
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function LiveBoard({ state }: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.liveNotes.length])

  const publish = async (text = draft): Promise<void> => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await window.argos.sendLiveNote(text)
      setDraft('')
    } catch {
      // el error viaja en state.lastError
    } finally {
      setBusy(false)
    }
  }

  const copy = async (note: LiveNote): Promise<void> => {
    await window.argos.clipboardWrite(note.text)
    setCopiedId(note.id)
    window.setTimeout(() => {
      setCopiedId((current) => (current === note.id ? '' : current))
    }, 1400)
  }

  const pasteHere = async (): Promise<void> => {
    const text = await window.argos.clipboardRead()
    if (text) setDraft(text)
  }

  return (
    <section className="card live">
      <div className="live-head">
        <div>
          <h2>Pizarra en vivo</h2>
          <p className="hint">
            {state.liveConnected
              ? 'Pegá texto y tocá una nota para copiarla'
              : 'Sin canal en vivo · conectá a la PC Casa'}
          </p>
        </div>
        <span className={state.liveConnected ? 'dot' : 'dot off'} />
      </div>

      <div className="live-list" ref={listRef}>
        {state.liveNotes.length === 0 ? (
          <p className="live-empty">Todavía no hay notas. Pegá un texto y compartilo.</p>
        ) : (
          state.liveNotes.map((note) => {
            const mine = note.fromId === state.me.id
            return (
              <button
                key={note.id}
                type="button"
                className={`live-note ${mine ? 'mine' : ''} ${copiedId === note.id ? 'copied' : ''}`}
                onClick={() => void copy(note)}
              >
                <span className="live-note-meta">
                  <strong>{mine ? 'Vos' : note.fromName}</strong>
                  <span>{copiedId === note.id ? 'Copiado' : formatTime(note.at)}</span>
                </span>
                <span className="live-note-text">{note.text}</span>
              </button>
            )
          })
        )}
      </div>

      <textarea
        className="live-draft"
        rows={4}
        placeholder="Pegá o escribí acá… Enter para compartir"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void publish()
          }
        }}
      />
      <div className="live-actions">
        <button className="ghost" type="button" onClick={() => void pasteHere()}>
          Pegar
        </button>
        <button
          className="ghost"
          type="button"
          disabled={state.liveNotes.length === 0}
          onClick={() => void window.argos.clearLiveNotes()}
        >
          Vaciar
        </button>
        <button
          className="primary live-send"
          type="button"
          disabled={busy || !draft.trim()}
          onClick={() => void publish()}
        >
          Compartir
        </button>
      </div>
    </section>
  )
}
