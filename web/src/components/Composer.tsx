import { useRef } from 'react'
import type { Attachment } from '../types'

type Props = { value: string; attachments: Attachment[]; runActive: boolean; revision?: string | null; onChange: (value: string) => void; onAttachments: (attachments: Attachment[]) => void; onSend: (attachments: Attachment[]) => void; onCancel: () => void; onRemoveAttachment: (name: string) => void }

export function Composer({ value, attachments, runActive, revision, onChange, onAttachments, onSend, onCancel, onRemoveAttachment }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const submit = () => { if (value.trim()) onSend(attachments) }
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }
  const readFiles = async (files: FileList | null) => {
    const next = (await Promise.all(Array.from(files ?? []).slice(0, 5).map(async file => {
      if (file.size > 120_000) return null
      const content = file.type.startsWith('text/') || /\.(md|mdx|txt|json|rs|ts|tsx|js|jsx|toml|yaml|yml|py|go|html|css)$/i.test(file.name) ? await file.text() : `[binary attachment: ${file.type || 'unknown'}]`
      return { name: file.name, mime_type: file.type || 'application/octet-stream', content, size: file.size }
    }))).filter((file): file is Attachment => file !== null)
    onAttachments([...attachments, ...next.filter(file => !attachments.some(existing => existing.name === file.name))])
  }
  return <form className="composer" onSubmit={event => { event.preventDefault(); submit() }}><textarea id="rivet-composer" name="prompt" autoComplete="off" aria-label="Prompt Rivet" value={value} onChange={event => onChange(event.target.value)} onKeyDown={onKeyDown} placeholder={runActive ? 'Steer the live run…' : 'Describe a bounded outcome…'} rows={2} /><div className="composer-bar"><div className="composer-tools"><button type="button" className="attach" aria-label="Attach files" onClick={() => input.current?.click()}><svg viewBox="0 0 24 24" width="14" height="14"><path d="m8.5 12.5 6-6a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 1 1-7.1-7.1l8.1-8.1" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="m6.7 14.3 7.2-7.2" fill="none" stroke="currentColor" strokeWidth="1.7"/></svg></button><span className="chip">repo:rivet</span><span className="chip">rev:{revision ?? "—"}</span>{attachments.map(file => <button type="button" className="chip file-chip" key={file.name} onClick={() => onRemoveAttachment(file.name)} title="Remove attachment">{file.name} ×</button>)}</div><div className="composer-right"><span>{runActive ? 'steer' : 'message'} · {value.length}</span>{runActive && <button type="button" className="cancel-button" onClick={onCancel}>stop</button>}<button type="submit" className="send" aria-label={runActive ? 'Steer live run' : 'Send message'} disabled={!value.trim()}><svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 19V5" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="m6.5 10.5 5.5-5.5 5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.7"/></svg></button></div></div><input ref={input} type="file" multiple hidden onChange={event => { void readFiles(event.target.files); event.target.value = '' }} /></form>
}
