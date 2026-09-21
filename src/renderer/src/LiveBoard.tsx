import { useEffect, useRef, useState } from 'react'
import type { AppState, LiveNote } from '../../shared/types'

type Props = {
  state: AppState
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isImageNote(note: LiveNote): boolean {
  return note.kind === 'image' || Boolean(note.image)
}

export default function LiveBoard({ state }: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [draftImage, setDraftImage] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.liveNotes.length])

  const publish = async (payload?: { text?: string; image?: string }): Promise<void> => {
    const next = payload || { text: draft, image: draftImage || undefined }
    if ((!next.text?.trim() && !next.image) || busy) return
    setBusy(true)
    try {
      await window.argos.sendLiveNote(next)
      setDraft('')
      setDraftImage(null)
    } catch {
      // el error viaja en state.lastError
    } finally {
      setBusy(false)
    }
  }

  const copy = async (note: LiveNote): Promise<void> => {
    if (isImageNote(note) && note.image) {
      await window.argos.clipboardWriteImage(note.image)
    } else {
      await window.argos.clipboardWrite(note.text)
    }
    setCopiedId(note.id)
    window.setTimeout(() => {
      setCopiedId((current) => (current === note.id ? '' : current))
    }, 1400)
  }

  const pasteHere = async (): Promise<void> => {
    const image = await window.argos.clipboardReadImage()
    if (image) {
      setDraftImage(image)
      return
    }
    const text = await window.argos.clipboardRead()
    if (text) setDraft(text)
  }

  const onPaste = (event: React.ClipboardEvent): void => {
    const items = [...event.clipboardData.items]
    const imageItem = items.find((item) => item.type.startsWith('image/'))
    if (!imageItem) return
    event.preventDefault()
    const file = imageItem.getAsFile()
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      void window.argos.compressImage(reader.result).then((compressed) => {
        if (compressed) setDraftImage(compressed)
      })
    }
    reader.readAsDataURL(file)
  }

  return (
    <section className="card live" onPaste={onPaste}>
      <div className="live-head">
        <div>
          <h2>Pizarra en vivo</h2>
          <p className="hint">
            {state.liveConnected
              ? 'Texto o capturas · tocá una nota para copiarla'
              : 'Sin canal en vivo · conectá a la PC Casa'}
          </p>
        </div>
        <span className={state.liveConnected ? 'dot' : 'dot off'} />
      </div>

      <div className="live-list" ref={listRef}>
        {state.liveNotes.length === 0 ? (
          <p className="live-empty">Todavía no hay notas. Pegá texto o una captura.</p>
        ) : (
          state.liveNotes.map((note) => {
            const mine = note.fromId === state.me.id
            const image = isImageNote(note)
            return (
              <button
                key={note.id}
                type="button"
                className={`live-note ${mine ? 'mine' : ''} ${copiedId === note.id ? 'copied' : ''} ${image ? 'has-image' : ''}`}
                onClick={() => void copy(note)}
              >
                <span className="live-note-meta">
                  <strong>{mine ? 'Vos' : note.fromName}</strong>
                  <span>
                    {copiedId === note.id
                      ? 'Copiado'
                      : image
                        ? `Imagen · ${formatTime(note.at)}`
                        : formatTime(note.at)}
                  </span>
                </span>
                {image && note.image ? (
                  <img className="live-note-image" src={note.image} alt={note.text || 'Captura'} />
                ) : (
                  <span className="live-note-text">{note.text}</span>
                )}
              </button>
            )
          })
        )}
      </div>

      {draftImage ? (
        <div className="live-draft-image">
          <img src={draftImage} alt="Vista previa" />
          <button className="ghost" type="button" onClick={() => setDraftImage(null)}>
            Quitar imagen
          </button>
        </div>
      ) : null}

      <textarea
        className="live-draft"
        rows={4}
        placeholder="Pegá texto o una captura (Ctrl+V)… Enter para compartir"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={onPaste}
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
          disabled={busy || (!draft.trim() && !draftImage)}
          onClick={() => void publish()}
        >
          Compartir
        </button>
      </div>
    </section>
  )
}
