import { useEffect, useState } from 'react'
import type { AppState } from '../../shared/types'

export default function DockApp(): React.JSX.Element {
  const [over, setOver] = useState(false)
  const [peerId, setPeerId] = useState<string>('')

  useEffect(() => {
    document.documentElement.classList.add('dock')
    document.body.classList.add('dock')
    void window.argos.getState().then((state: AppState) => {
      setPeerId(state.peers[0]?.id || '')
    })
    return window.argos.onState((state) => {
      setPeerId((current) => current || state.peers[0]?.id || '')
    })
  }, [])

  return (
    <div
      className={`dock-strip ${over ? 'over' : ''}`}
      title="Soltá archivos para enviarlos"
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const paths = [...event.dataTransfer.files]
          .map((file) => window.argos.getPathForFile(file))
          .filter(Boolean)
        if (paths.length > 0) {
          void window.argos.sendFiles(peerId || undefined, paths)
        }
      }}
      onDoubleClick={() => {
        void window.argos.showWindow()
      }}
    >
      ↕
    </div>
  )
}
