import { useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, Census } from '../types'

type Props = {
  value: string
  attachments: Attachment[]
  runActive: boolean
  revision?: string | null
  census?: Census | null
  onChange: (value: string) => void
  onAttachments: (attachments: Attachment[]) => void
  onSend: (attachments: Attachment[]) => void
  onCancel: () => void
  onRemoveAttachment: (name: string) => void
}

export function Composer({
  value,
  attachments,
  runActive,
  revision,
  census,
  onChange,
  onAttachments,
  onSend,
  onCancel,
  onRemoveAttachment,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (value.trim().length > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [value])

  const candidateFiles = useMemo(() => {
    if (!census) return []
    const paths = census.directories.map(d => d.relative_path)
    if (!mentionFilter) return paths.slice(0, 8)
    const q = mentionFilter.toLowerCase()
    return paths.filter(p => p.toLowerCase().includes(q)).slice(0, 8)
  }, [census, mentionFilter])

  const submit = () => {
    const trimmed = value.trim()
    if (trimmed) {
      onSend(attachments)
    }
  }

  const handleMentionSelect = (file: string) => {
    const lastAtIndex = value.lastIndexOf('@')
    if (lastAtIndex !== -1) {
      const before = value.slice(0, lastAtIndex)
      const newValue = `${before}@${file} `
      onChange(newValue)
    }
    setMentionActive(false)
    textareaRef.current?.focus()
  }

  const handleInputChange = (text: string) => {
    onChange(text)
    const cursor = textareaRef.current?.selectionStart ?? text.length
    const textBeforeCursor = text.slice(0, cursor)
    const lastAt = textBeforeCursor.lastIndexOf('@')
    if (lastAt !== -1 && !/\s/.test(textBeforeCursor.slice(lastAt + 1))) {
      const filter = textBeforeCursor.slice(lastAt + 1)
      setMentionFilter(filter)
      setMentionActive(true)
      setHighlightIndex(0)
    } else {
      setMentionActive(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionActive && candidateFiles.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlightIndex(i => (i + 1) % candidateFiles.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlightIndex(i => (i - 1 + candidateFiles.length) % candidateFiles.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        handleMentionSelect(candidateFiles[highlightIndex])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionActive(false)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const readFiles = async (files: FileList | null) => {
    const next = (
      await Promise.all(
        Array.from(files ?? []).slice(0, 5).map(async file => {
          if (file.size > 120_000) return null
          const content =
            file.type.startsWith('text/') ||
            /\.(md|mdx|txt|json|rs|ts|tsx|js|jsx|toml|yaml|yml|py|go|html|css)$/i.test(file.name)
              ? await file.text()
              : `[binary attachment: ${file.type || 'unknown'}]`
          return { name: file.name, mime_type: file.type || 'application/octet-stream', content, size: file.size }
        })
      )
    ).filter((file): file is Attachment => file !== null)

    onAttachments([
      ...attachments,
      ...next.filter(file => !attachments.some(existing => existing.name === file.name)),
    ])
  }

  return (
    <form className="composer" onSubmit={event => { event.preventDefault(); submit() }}>
      <div className="composer-card">
        {mentionActive && candidateFiles.length > 0 && (
          <div className="mention-popover" role="listbox" aria-label="Mention file">
            <div className="mention-header">Mention repository file (@)</div>
            {candidateFiles.map((file, idx) => (
              <button
                key={file}
                type="button"
                role="option"
                aria-selected={idx === highlightIndex}
                className={`mention-item ${idx === highlightIndex ? 'active' : ''}`}
                onMouseDown={e => { e.preventDefault(); handleMentionSelect(file) }}
              >
                <span>{file}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          id="rivet-composer"
          name="prompt"
          autoComplete="off"
          spellCheck={false}
          aria-label="Prompt Rivet"
          value={value}
          onChange={event => handleInputChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={runActive ? 'Steer the live run…' : 'Describe what to build or fix (type @ to reference files)…'}
          rows={2}
        />

        <div className="composer-bar">
          <div className="composer-tools">
            <button
              type="button"
              className="attach"
              aria-label="Attach files to message"
              onClick={() => input.current?.click()}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="m8.5 12.5 6-6a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 1 1-7.1-7.1l8.1-8.1" />
                <path d="m6.7 14.3 7.2-7.2" />
              </svg>
            </button>

            {revision && <span className="chip">r{revision}</span>}

            {attachments.map(file => (
              <button
                type="button"
                className="chip file-chip"
                key={file.name}
                onClick={() => onRemoveAttachment(file.name)}
                aria-label={`Remove attachment ${file.name}`}
                title="Remove attachment"
              >
                {file.name} ×
              </button>
            ))}
          </div>

          <div className="composer-right">
            <span>{runActive ? 'Live' : 'Ready'} · {value.length}</span>
            {runActive && (
              <button type="button" className="cancel-button" onClick={onCancel}>
                Stop
              </button>
            )}
            <button
              type="submit"
              className="send"
              aria-label={runActive ? 'Steer live run' : 'Send message'}
              disabled={!value.trim()}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M12 19V5" />
                <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Upload files"
        onChange={event => { void readFiles(event.target.files); event.target.value = '' }}
      />
    </form>
  )
}
